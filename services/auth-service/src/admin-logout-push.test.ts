import { EventEmitter } from 'node:events';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthConfig } from './config';
import { handleAdminApi } from './admin-api';

/**
 * IdP-initiated back-channel logout emission through the admin destroy API.
 * Hermetic: Prisma and cross-origin checks are doubled, HTTP pushes are a
 * stubbed global fetch routed by hostname, Redis is an in-memory fake.
 */

const harness = vi.hoisted(() => ({
  auditRows: [] as Array<Record<string, unknown>>,
}));

vi.mock('./db', () => ({
  prisma: {
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        harness.auditRows.push(data);
        return data;
      },
    },
    oidcClient: { findMany: async () => [] },
    authBrandingProfile: { findMany: async () => [] },
  },
}));

vi.mock('./admin-auth', () => ({
  sameOriginRequest: () => true,
}));

const redisStore = new Map<string, string>();

function makeRedis() {
  return {
    async get(key: string): Promise<string | null> {
      return redisStore.get(key) ?? null;
    },
    async set(key: string, value: string): Promise<unknown> {
      redisStore.set(key, value);
      return 'OK';
    },
    async del(...keys: string[]): Promise<unknown> {
      let removed = 0;
      for (const key of keys) if (redisStore.delete(key)) removed += 1;
      return removed;
    },
    async *scanIterator(opts: { MATCH: string }): AsyncIterable<string> {
      const prefix = opts.MATCH.replace(/\*$/, '');
      for (const key of [...redisStore.keys()]) {
        if (key.startsWith(prefix)) yield key;
      }
    },
  };
}

function configFixture(): AuthConfig {
  return {
    issuer: 'https://auth.example.test',
    port: 3003,
    databaseUrl: 'postgres://unused',
    redisUrl: 'redis://unused',
    cookieKeys: ['k1'],
    clientId: 'uar-portal',
    clientSecret: 's3cret-value',
    redirectUris: ['http://localhost:3002/api/auth/oidc/callback'],
    postLogoutRedirects: ['http://localhost:3002'],
    backchannelLogoutUri: 'http://localhost:3002/api/auth/oidc/backchannel-logout',
    ldapDomain: 'example.test',
    ldapUrl: 'ldaps://dc.example.test:636',
    ldapSearchBase: 'DC=example,DC=test',
    ldapBindDn: '',
    ldapBindPassword: '',
    allowInvalidCertificates: false,
    turnstileSiteKey: 'site',
    turnstileSecretKey: 'secret',
    loginWindowMs: 900_000,
    loginMaxAttempts: 20,
    accountLockWindowMs: 900_000,
    accountLockMaxAttempts: 5,
    internalBrandingToken: '',
    adminUsernames: ['ops-admin'],
    adminGroups: [],
  } as AuthConfig;
}

interface FetchCall {
  url: string;
  init: { method: string; headers: Record<string, string>; body: string };
}

function stubFetch(
  route: (url: string) => number | never
): { calls: FetchCall[]; restore: () => void } {
  const calls: FetchCall[] = [];
  const impl = async (url: string, init: FetchCall['init']): Promise<{ status: number }> => {
    calls.push({ url, init });
    const status = route(url);
    return { status };
  };
  vi.stubGlobal('fetch', impl);
  return { calls, restore: () => vi.unstubAllGlobals() };
}

class FakeJsonRequest extends EventEmitter {
  method = 'POST';
  headers: Record<string, string>;

  constructor(body: Record<string, unknown>) {
    super();
    this.headers = { 'content-type': 'application/json' };
    setImmediate(() => {
      this.emit('data', Buffer.from(JSON.stringify(body)));
      this.emit('end');
    });
  }
}

async function postDestroy(
  redis: ReturnType<typeof makeRedis>,
  body: Record<string, unknown>
): Promise<{ status: number; json: Record<string, unknown> }> {
  let status = 0;
  let raw = '';
  const res = {
    writeHead(code: number): unknown {
      status = code;
      return res;
    },
    end(chunk?: string | Buffer): unknown {
      if (chunk !== undefined) raw += chunk.toString();
      return res;
    },
  };
  await handleAdminApi(
    new FakeJsonRequest(body) as unknown as IncomingMessage,
    res as unknown as ServerResponse,
    'sessions/destroy',
    'ops-admin',
    configFixture(),
    redis as never
  );
  return { status, json: raw ? (JSON.parse(raw) as Record<string, unknown>) : {} };
}

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

function seedFixtures(): void {
  redisStore.clear();
  harness.auditRows.length = 0;
  redisStore.set(
    'oidc:Session:sess-a10',
    JSON.stringify({
      jti: 'sess-a10',
      kind: 'Session',
      uid: 'uid-a1',
      accountId: 'alice',
      loginTs: nowSeconds() - 60,
      exp: nowSeconds() + 3600,
      authorizations: {
        'uar-portal': { sid: 'ps-portal-a1' },
        'acme-app': { sid: 'ps-acme-a1' },
        'sidless-app': { grantId: 'grant-x1' },
      },
    })
  );
  redisStore.set(
    'oidc:Session:sess-a20',
    JSON.stringify({
      jti: 'sess-a20',
      kind: 'Session',
      uid: 'uid-a2',
      accountId: 'alice',
      exp: nowSeconds() + 3600,
      authorizations: { 'dead-app': { sid: 'ps-dead-a2' } },
    })
  );
  redisStore.set(
    'oidc:Session:sess-bob',
    JSON.stringify({
      jti: 'sess-bob',
      kind: 'Session',
      uid: 'uid-bob',
      accountId: 'bob',
      exp: nowSeconds() + 3600,
      authorizations: { 'uar-portal': { sid: 'ps-portal-bob' } },
    })
  );
  redisStore.set(
    'oidc:Client:uar-portal',
    JSON.stringify({ client_id: 'uar-portal', backchannel_logout_uri: 'https://portal.example/bcl' })
  );
  // acme-app has NO explicit backchannel uri: derived from redirect URIs.
  redisStore.set(
    'oidc:Client:acme-app',
    JSON.stringify({ client_id: 'acme-app', redirect_uris: ['https://acme.example/cb'] })
  );
}

/** portal => 200 OK, acme (derived uri) => 503, anything else never called. */
function stubMixedOutcomes(): { calls: FetchCall[]; restore: () => void } {
  return stubFetch((url) => {
    if (url.startsWith('https://portal.example/')) return 200;
    if (url.startsWith('https://acme.example/')) return 503;
    throw new Error(`unexpected push target ${url}`);
  });
}

describe('POST /admin/api/sessions/destroy back-channel logout emission', () => {
  let redis: ReturnType<typeof makeRedis>;
  let fetcher: ReturnType<typeof stubMixedOutcomes>;

  beforeEach(() => {
    redis = makeRedis();
    seedFixtures();
    fetcher = stubMixedOutcomes();
  });

  afterEach(() => {
    fetcher.restore();
  });

  function forceLogoutRow(): Record<string, unknown> | undefined {
    return harness.auditRows.find((row) => row.action === 'SESSION_FORCE_LOGOUT');
  }

  it('sid scope: pushes one signed logout_token per destroyed authorization and audits outcomes', async () => {
    const { status, json } = await postDestroy(redis, { scope: 'sid', target: 'sess-a10' });

    expect(status).toBe(200);
    expect(json).toMatchObject({ scope: 'sid', target: 'sess-a10', destroyed: 1, failed: 0 });
    expect(json.pushed).toEqual({ delivered: 1, failed: 1 });

    // Two pushes: registered uri + derived-from-redirect uri. The sid-less
    // authorization is skipped entirely.
    expect(fetcher.calls).toHaveLength(2);
    const byHost = new Map(fetcher.calls.map((call) => [new URL(call.url).host, call]));
    const portalCall = byHost.get('portal.example');
    const acmeCall = byHost.get('acme.example');
    expect(acmeCall?.url).toBe('https://acme.example/api/auth/oidc/backchannel-logout');
    for (const call of [portalCall, acmeCall]) {
      expect(call).toBeDefined();
      expect(call!.init.method).toBe('POST');
      expect(call!.init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      const params = new URLSearchParams(call!.init.body);
      expect([...params.keys()]).toEqual(['logout_token']);
      const claims = JSON.parse(
        Buffer.from(params.get('logout_token')!.split('.')[1], 'base64url').toString('utf8')
      );
      expect(claims.iss).toBe('https://auth.example.test');
      expect(claims.events).toEqual({
        'http://schemas.openid.net/event/backchannel-logout': {},
      });
      expect(claims.nonce).toBeUndefined();
    }
    expect(
      JSON.parse(
        Buffer.from(
          new URLSearchParams(portalCall!.init.body).get('logout_token')!.split('.')[1],
          'base64url'
        ).toString('utf8')
      )
    ).toMatchObject({ aud: 'uar-portal', sid: 'ps-portal-a1', sub: 'alice' });

    // Durable IdP-side truth: per-RP outcomes on the SAME audit row.
    const row = forceLogoutRow();
    expect(row).toMatchObject({ username: 'ops-admin', actorType: 'admin', outcome: 'success' });
    const details = JSON.parse(String(row?.details));
    expect(details.scope).toBe('sid');
    expect(details.target).toBe('sess-a10');
    expect(details.destroyed).toBe(1);
    expect(details.backchannelPushes).toEqual({ delivered: 1, failed: 1 });
    expect(details.deliveries).toEqual([
      { clientId: 'acme-app', outcome: 'rejected', status: 503 },
      { clientId: 'uar-portal', outcome: 'delivered', status: 200 },
    ]);

    // Destruction itself completed regardless of the rejected RP.
    expect(redisStore.has('oidc:Session:sess-a10')).toBe(false);
    expect(redisStore.has('oidc:Session:sess-a20')).toBe(true);
    expect(redisStore.has('oidc:Session:sess-bob')).toBe(true);
  });

  it('user scope: every destroyed session triggers pushes incl. unknown RPs reported unreachable', async () => {
    const { status, json } = await postDestroy(redis, { scope: 'user', target: ' Alice ' });

    expect(status).toBe(200);
    expect(json).toMatchObject({ scope: 'user', target: 'Alice', destroyed: 2, failed: 0 });
    // portal delivered, acme rejected, dead-app has NO registered uri.
    expect(json.pushed).toEqual({ delivered: 1, failed: 2 });

    const details = JSON.parse(String(forceLogoutRow()?.details));
    expect(details.deliveries).toEqual(
      expect.arrayContaining([
        { clientId: 'acme-app', outcome: 'rejected', status: 503 },
        { clientId: 'uar-portal', outcome: 'delivered', status: 200 },
        { clientId: 'dead-app', outcome: 'unreachable' },
      ])
    );

    // Unreachable/rejected RPs did NOT block destruction.
    expect(redisStore.has('oidc:Session:sess-a10')).toBe(false);
    expect(redisStore.has('oidc:Session:sess-a20')).toBe(false);
    expect(redisStore.has('oidc:Session:sess-bob')).toBe(true);
  });

  it('client scope: only the target app receives pushes', async () => {
    const { status, json } = await postDestroy(redis, { scope: 'client', target: 'acme-app' });

    expect(status).toBe(200);
    expect(json).toMatchObject({ scope: 'client', target: 'acme-app', destroyed: 1, failed: 0 });
    expect(json.deliveries).toEqual([{ clientId: 'acme-app', outcome: 'rejected', status: 503 }]);
    expect(json.pushed).toEqual({ delivered: 0, failed: 1 });

    // Only alice's session held the acme authorization.
    expect(redisStore.has('oidc:Session:sess-a10')).toBe(false);
    expect(redisStore.has('oidc:Session:sess-bob')).toBe(true);
    const pushedHosts = fetcher.calls.map((call) => new URL(call.url).host);
    expect(pushedHosts).toEqual(['acme.example']);
  });

  it('no-match sweeps stay honest: nothing destroyed, nothing pushed', async () => {
    const { status, json } = await postDestroy(redis, { scope: 'user', target: 'nobody' });

    expect(status).toBe(200);
    expect(json).toMatchObject({
      destroyed: 0,
      failed: 0,
      deliveries: [],
      pushed: { delivered: 0, failed: 0 },
    });
    expect(fetcher.calls).toHaveLength(0);
    expect(forceLogoutRow()).toMatchObject({ outcome: 'no_match' });
  });

  it('rejects unknown scopes before touching sessions or RPs', async () => {
    const { status, json } = await postDestroy(redis, { scope: 'everything', target: 'x' });
    expect(status).toBe(400);
    expect(json.error).toBe('invalid_request');
    expect(fetcher.calls).toHaveLength(0);
    expect(harness.auditRows).toHaveLength(0);
  });
});
