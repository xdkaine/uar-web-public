import type { Adapter, AdapterPayload } from 'oidc-provider';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { attachLoginContext, type ScanCapableRedis } from './session-store';

const PREFIX = 'oidc:';
/**
 * Hard ceiling the Redis adapter applies to EVERY expiring provider record.
 * Registry-configured session lifetimes must never exceed this value (see
 * MAX_SESSION_TTL_SECONDS in oidc-clients.ts) or long sessions are killed
 * early by this clamp while the provider still believes they are alive.
 */
export const PROVIDER_RECORD_TTL_CEILING_SECONDS = 14 * 24 * 60 * 60;
const DEFAULT_TTL_SECONDS = PROVIDER_RECORD_TTL_CEILING_SECONDS;

interface RedisLike {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    options?: { EX?: number; PX?: number; NX?: boolean }
  ): Promise<unknown>;
  expire(key: string, seconds: number): Promise<unknown>;
  del(...keys: string[]): Promise<unknown>;
  eval?(
    script: string,
    options: { keys: string[]; arguments: string[] }
  ): Promise<unknown>;
}

/**
 * Generic oidc-provider adapter over shared Redis. Provider state (codes,
 * sessions, grants, interaction uids) survives restarts and stays scoped to
 * the auth service namespace. Payloads are opaque JSON.
 */
export class RedisAdapter implements Adapter {
  private readonly lockContext = new AsyncLocalStorage<{
    key: string;
    token: string;
    lost: boolean;
  }>();

  constructor(
    private readonly name: string,
    private readonly redis: RedisLike,
    private readonly lockOptions: {
      leaseMs?: number;
      renewEveryMs?: number;
      acquireTimeoutMs?: number;
      retryMs?: number;
    } = {}
  ) {}

  private key(id: string): string {
    return `${PREFIX}${this.name}:${id}`;
  }

  private userCodeKey(userCode: string): string {
    return `${PREFIX}userCode:${this.name}:${userCode}`;
  }

  /**
   * Cross-process client-mutation lock. Dynamic client updates span the
   * durable PostgreSQL record and this Redis mirror, so database isolation
   * alone cannot serialize a post-commit mirror write against deletion.
   */
  async withLock<T>(id: string, work: () => Promise<T>): Promise<T> {
    if (!this.redis.eval) throw new Error('Redis lock primitives are unavailable');
    const key = `${PREFIX}lock:${this.name}:${id}`;
    const token = randomUUID();
    const leaseMs = this.lockOptions.leaseMs ?? 120_000;
    const renewEveryMs = this.lockOptions.renewEveryMs ?? 30_000;
    const deadline = Date.now() + (this.lockOptions.acquireTimeoutMs ?? 5_000);
    while (true) {
      const acquired = await this.redis.set(key, token, { NX: true, PX: leaseMs });
      if (acquired === 'OK') break;
      if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${this.name} mutation lock`);
      await new Promise((resolve) => setTimeout(resolve, this.lockOptions.retryMs ?? 25));
    }
    const context = { key, token, lost: false };
    let renewalRunning = false;
    const renewal = setInterval(() => {
      if (renewalRunning || context.lost) return;
      renewalRunning = true;
      void this.redis.eval?.(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('pexpire', KEYS[1], ARGV[2]) else return 0 end",
        { keys: [key], arguments: [token, String(leaseMs)] }
      ).then((result) => {
        if (Number(result) !== 1) context.lost = true;
      }).catch(() => {
        context.lost = true;
      }).finally(() => {
        renewalRunning = false;
      });
    }, renewEveryMs);
    renewal.unref();
    try {
      return await this.lockContext.run(context, work);
    } finally {
      clearInterval(renewal);
      try {
        await this.redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          { keys: [key], arguments: [token] }
        );
      } catch (error) {
        // The token TTL bounds a failed release. Do not turn an already
        // committed and mirrored mutation into a misleading API failure.
        console.error(`[auth] failed to release ${this.name} mutation lock`, error);
      }
    }
  }

  private activeClientLock(): { key: string; token: string; lost: boolean } | undefined {
    return this.name === 'Client' ? this.lockContext.getStore() : undefined;
  }

  async upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<void> {
    const lock = this.activeClientLock();
    if (lock) {
      if (lock.lost || !this.redis.eval) throw new Error('Client mutation lock was lost');
      const result = await this.redis.eval(
        "if redis.call('get', KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('set', KEYS[2], ARGV[2]); return 1",
        { keys: [lock.key, this.key(id)], arguments: [lock.token, JSON.stringify(payload)] }
      );
      if (Number(result) !== 1) {
        lock.lost = true;
        throw new Error('Client mutation lock was lost');
      }
      return;
    }
    // expiresIn <= 0 (or non-finite) is a sentinel for "no expiry": used by
    // the dynamic client registry whose records must never silently age out.
    if (!Number.isFinite(expiresIn) || expiresIn <= 0) {
      await this.redis.set(this.key(id), JSON.stringify(payload));
      if (payload.uid) {
        await this.redis.set(`${PREFIX}${this.name}:uid:${payload.uid}`, id);
      }
      return;
    }
    const ttl = Math.max(1, Math.min(expiresIn || DEFAULT_TTL_SECONDS, DEFAULT_TTL_SECONDS));
    await this.redis.set(this.key(id), JSON.stringify(payload), { EX: ttl });

    // ADR-0014: attach captured sign-in context (IP/UA/device) to newly
    // authenticated sessions. Best-effort and once-per-session inside the
    // helper; failures here never break provider session persistence.
    if (
      this.name === 'Session' &&
      typeof payload.accountId === 'string' &&
      payload.accountId
    ) {
      await attachLoginContext(
        this.redis as unknown as ScanCapableRedis,
        payload.accountId,
        id,
        ttl,
        typeof payload.uid === 'string' ? payload.uid : undefined
      );
    }

    // Secondary indexes mirror oidc-provider's memory adapter: sessions are
    // looked up by uid during interaction resolution, device flows by userCode.
    if (payload.uid) {
      await this.redis.set(`${PREFIX}${this.name}:uid:${payload.uid}`, id, { EX: ttl });
    }

    if (payload.userCode) {
      await this.redis.set(this.userCodeKey(String(payload.userCode)), id, { EX: ttl });
    }
  }

  async find(id: string): Promise<AdapterPayload | undefined> {
    const raw = await this.redis.get(this.key(id));
    if (!raw) return undefined;
    try {
      return JSON.parse(raw) as AdapterPayload;
    } catch {
      return undefined;
    }
  }

  async findByUid(uid: string): Promise<AdapterPayload | undefined> {
    // The uid index stores the primary id; resolve it before reading payload.
    const id = await this.redis.get(`${PREFIX}${this.name}:uid:${uid}`);
    return id ? this.find(id) : undefined;
  }

  async findByUserCode(userCode: string): Promise<AdapterPayload | undefined> {
    const id = await this.redis.get(this.userCodeKey(userCode));
    return id ? this.find(id) : undefined;
  }

  async destroy(id: string): Promise<void> {
    const payload = await this.find(id);
    const lock = this.activeClientLock();
    if (lock) {
      if (lock.lost || !this.redis.eval) throw new Error('Client mutation lock was lost');
      const result = await this.redis.eval(
        "if redis.call('get', KEYS[1]) ~= ARGV[1] then return -1 end; return redis.call('del', KEYS[2])",
        { keys: [lock.key, this.key(id)], arguments: [lock.token] }
      );
      if (Number(result) < 0) {
        lock.lost = true;
        throw new Error('Client mutation lock was lost');
      }
    } else {
      await this.redis.del(this.key(id));
    }
    if (payload?.uid) {
      await this.redis.del(`${PREFIX}${this.name}:uid:${payload.uid}`);
    }
  }

  async revokeByGrantId(grantId: string): Promise<void> {
    // Linear scan is acceptable at this deployment scale; grant revocation is rare.
    const pattern = `${PREFIX}${this.name}:*`;
    for await (const key of scanKeys(this.redis, pattern)) {
      const raw = await this.redis.get(key);
      if (!raw) continue;
      try {
        const payload = JSON.parse(raw) as { grantId?: string };
        if (payload.grantId === grantId) {
          await this.redis.del(key);
        }
      } catch {
        // skip unreadable entries
      }
    }
  }

  async consume(id: string): Promise<void> {
    const payload = await this.find(id);
    if (!payload) return;
    payload.consumed = Math.floor(Date.now() / 1000);
    await this.upsert(id, payload, 300); // short grace window
  }
}

async function* scanKeys(redis: RedisLike, _pattern: string): AsyncGenerator<string> {
  // node-redis v5 exposes scanIter on the client; keep the adapter honest by
  // requiring it lazily so tests can inject a minimal stub.
  const iterable = (redis as unknown as { scanIterator?: (opts: { MATCH: string; COUNT: number }) => AsyncIterable<string> })
    .scanIterator;
  if (!iterable) return;
  for await (const key of (redis as unknown as {
    scanIterator: (opts: { MATCH: string; COUNT: number }) => AsyncIterable<string>;
  }).scanIterator({ MATCH: _pattern, COUNT: 100 })) {
    yield key;
  }
}
