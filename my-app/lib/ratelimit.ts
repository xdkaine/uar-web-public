interface RateLimitStoreEntry {
  count: number;
  resetTime: number;
  scope: string;
  identifier: string | null;
  limit: number;
  windowMs: number;
  updatedAt: number;
}

interface RateLimitStore {
  [key: string]: RateLimitStoreEntry;
}

const store: RateLimitStore = {};

export interface RedisRateLimitClient {
  incr(key: string): Promise<number>;
  incrementWithFirstExpiry(key: string, seconds: number): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  ttl(key: string): Promise<number>;
  get(key: string): Promise<unknown>;
  setWithExpiry(key: string, value: string, seconds: number): Promise<unknown>;
  setIfAbsentWithExpiry(key: string, value: string, seconds: number): Promise<boolean>;
  setIfOwnerWithExpiry(
    ownerKey: string,
    expectedOwner: string,
    targetKey: string,
    value: string,
    seconds: number,
    ownerSeconds: number
  ): Promise<boolean>;
  deleteIfValue(key: string, expectedValue: string): Promise<boolean>;
  del(key: string): Promise<number>;
  scanKeys(pattern: string): Promise<string[]>;
}

interface NodeRedisAdapter {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<number | boolean>;
  ttl(key: string): Promise<number>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { EX: number; NX?: boolean }): Promise<string | null>;
  eval(script: string, options: { keys: string[]; arguments: string[] }): Promise<unknown>;
  del(key: string): Promise<number>;
  scanIterator?: (options: { MATCH: string; COUNT: number }) => AsyncIterable<string | string[]>;
  scan?: (cursor: string, options: { MATCH: string; COUNT: number }) => Promise<{ cursor: string | number; keys: string[] }>;
}

let redisClient: RedisRateLimitClient | null = null;
let redisInitPromise: Promise<RedisRateLimitClient> | null = null;

const isRedisEnabled = typeof process !== 'undefined' && !!process.env.REDIS_URL;

export class RateLimitUnavailableError extends Error {
  constructor(message: string = 'Rate limit service is unavailable') {
    super(message);
    this.name = 'RateLimitUnavailableError';
  }
}

export class ClientIpUnavailableError extends RateLimitUnavailableError {
  constructor(
    message: string = 'Client IP address is unavailable for rate limiting. Configure TRUST_PROXY_HEADERS=true behind a trusted reverse proxy.'
  ) {
    super(message);
    this.name = 'ClientIpUnavailableError';
  }
}

async function initializeRedisClient(): Promise<RedisRateLimitClient> {
  const redisUrl = process.env.REDIS_URL;

  if (!redisUrl) {
    throw new RateLimitUnavailableError('Redis URL is not configured');
  }

  const isUpstash = redisUrl.includes('upstash.io');

  if (isUpstash) {
    if (!process.env.REDIS_TOKEN) {
      throw new RateLimitUnavailableError('REDIS_TOKEN is required for Upstash Redis rate limiting');
    }

    const { Redis } = await import('@upstash/redis');
    const client = new Redis({
      url: redisUrl,
      token: process.env.REDIS_TOKEN,
    });

    console.log('[RateLimit] Upstash Redis client initialized for rate limiting');
    return {
      incr: (key) => client.incr(key),
      incrementWithFirstExpiry: async (key, seconds) => Number(await client.eval(
        "local count = redis.call('incr', KEYS[1]); if count == 1 then redis.call('expire', KEYS[1], ARGV[1]); elseif redis.call('ttl', KEYS[1]) < 0 then redis.call('set', KEYS[1], '1', 'EX', ARGV[1]); count = 1; end; return count",
        [key],
        [String(seconds)]
      )),
      expire: (key, seconds) => client.expire(key, seconds),
      ttl: (key) => client.ttl(key),
      get: (key) => client.get(key),
      setWithExpiry: (key, value, seconds) => client.set(key, value, { ex: seconds }),
      setIfAbsentWithExpiry: async (key, value, seconds) =>
        (await client.set(key, value, { ex: seconds, nx: true })) === 'OK',
      setIfOwnerWithExpiry: async (ownerKey, expectedOwner, targetKey, value, seconds, ownerSeconds) =>
        Number(await client.eval(
          "if redis.call('get', KEYS[1]) ~= ARGV[1] or redis.call('exists', KEYS[2]) == 1 then return 0 end; redis.call('expire', KEYS[1], ARGV[4]); redis.call('set', KEYS[2], ARGV[2], 'EX', ARGV[3]); return 1",
          [ownerKey, targetKey],
          [expectedOwner, value, String(seconds), String(ownerSeconds)]
        )) === 1,
      deleteIfValue: async (key, expectedValue) =>
        Number(await client.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          [key],
          [expectedValue]
        )) === 1,
      del: (key) => client.del(key),
      scanKeys: async (pattern) => {
        const keys: string[] = [];
        let cursor = 0;

        do {
          const [nextCursor, batch] = await client.scan(cursor, {
            match: pattern,
            count: 100,
          });
          keys.push(...batch);
          cursor = Number(nextCursor);
        } while (cursor !== 0);

        return keys;
      },
    };
  }

  const { createClient } = await import('redis');
  const client = createClient({ url: redisUrl });
  const nodeClient = client as unknown as NodeRedisAdapter;

  client.on('error', (err: Error) => {
    console.error('[RateLimit] Redis client error:', err);
  });

  await client.connect();
  console.log('[RateLimit] Redis client initialized');
  return {
    incr: (key) => nodeClient.incr(key),
    incrementWithFirstExpiry: async (key, seconds) => Number(await nodeClient.eval(
      "local count = redis.call('incr', KEYS[1]); if count == 1 then redis.call('expire', KEYS[1], ARGV[1]); elseif redis.call('ttl', KEYS[1]) < 0 then redis.call('set', KEYS[1], '1', 'EX', ARGV[1]); count = 1; end; return count",
      { keys: [key], arguments: [String(seconds)] }
    )),
    expire: (key, seconds) => nodeClient.expire(key, seconds),
    ttl: (key) => nodeClient.ttl(key),
    get: (key) => nodeClient.get(key),
    setWithExpiry: (key, value, seconds) => nodeClient.set(key, value, { EX: seconds }),
    setIfAbsentWithExpiry: async (key, value, seconds) =>
      (await nodeClient.set(key, value, { EX: seconds, NX: true })) === 'OK',
    setIfOwnerWithExpiry: async (ownerKey, expectedOwner, targetKey, value, seconds, ownerSeconds) =>
      Number(await nodeClient.eval(
        "if redis.call('get', KEYS[1]) ~= ARGV[1] or redis.call('exists', KEYS[2]) == 1 then return 0 end; redis.call('expire', KEYS[1], ARGV[4]); redis.call('set', KEYS[2], ARGV[2], 'EX', ARGV[3]); return 1",
        {
          keys: [ownerKey, targetKey],
          arguments: [expectedOwner, value, String(seconds), String(ownerSeconds)],
        }
      )) === 1,
    deleteIfValue: async (key, expectedValue) =>
      Number(await nodeClient.eval(
        "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
        { keys: [key], arguments: [expectedValue] }
      )) === 1,
    del: (key) => nodeClient.del(key),
    scanKeys: async (pattern) => {
      const keys: string[] = [];

      if (nodeClient.scanIterator) {
        for await (const chunk of nodeClient.scanIterator({ MATCH: pattern, COUNT: 100 })) {
          if (Array.isArray(chunk)) {
            keys.push(...chunk);
          } else {
            keys.push(chunk);
          }
        }

        return keys;
      }

      if (!nodeClient.scan) {
        return keys;
      }

      let cursor = '0';
      do {
        const result = await nodeClient.scan(cursor, { MATCH: pattern, COUNT: 100 });
        keys.push(...result.keys);
        cursor = String(result.cursor);
      } while (cursor !== '0');

      return keys;
    },
  };
}

async function getRedisClient(): Promise<RedisRateLimitClient | null> {
  if (!isRedisEnabled) {
    return null;
  }

  if (redisClient) {
    return redisClient;
  }

  if (!redisInitPromise) {
    redisInitPromise = initializeRedisClient()
      .then((client) => {
        redisClient = client;
        return client;
      })
      .catch((error) => {
        redisInitPromise = null;
        redisClient = null;
        const message = error instanceof Error ? error.message : 'Unknown Redis initialization error';
        throw new RateLimitUnavailableError(message);
      });
  }

  return redisInitPromise;
}

/**
 * Shared Redis control-plane client for auth safeguards that must agree
 * across portal replicas. Unlike development rate-limit fallback, callers of
 * this helper require Redis and therefore fail closed when it is unavailable.
 */
export async function getRequiredAuthRedisClient(): Promise<RedisRateLimitClient> {
  const client = await getRedisClient();
  if (!client) throw new RateLimitUnavailableError('Redis is required for the authentication control plane');
  return client;
}

if (!isRedisEnabled) {
  setInterval(() => {
    const now = Date.now();
    Object.keys(store).forEach((key) => {
      if (store[key].resetTime < now) {
        delete store[key];
      }
    });
  }, 10 * 60 * 1000);
}

export interface RateLimitConfig {
  /**
   * Maximum number of requests allowed within the window
   */
  maxRequests: number;

  /**
   * Time window in milliseconds
   */
  windowMs: number;

  /**
   * Optional identifier (e.g., email) in addition to IP
   */
  identifier?: string;
}

export interface RateLimitResult {
  success: boolean;
  limit: number;
  remaining: number;
  reset: number;
}

interface RateLimitMetadata {
  scope: string;
  identifier: string | null;
  limit: number;
  windowMs: number;
  updatedAt: number;
}

export interface RateLimitSession {
  id: string;
  key: string;
  storage: 'redis' | 'memory';
  scope: string;
  identifier: string | null;
  count: number;
  limit: number | null;
  remaining: number | null;
  reset: number | null;
  ttlSeconds: number | null;
  windowMs: number | null;
  updatedAt: number | null;
  status: 'tracking' | 'at_limit' | 'limited' | 'unknown';
}

export function isRateLimitUnavailable(error: unknown): error is RateLimitUnavailableError {
  return error instanceof RateLimitUnavailableError;
}

function buildRateLimitSubject(ip: string, identifier?: string): string {
  return identifier ? `${ip}:${identifier}` : ip;
}

function buildRedisRateLimitKey(ip: string, identifier?: string): string {
  return `ratelimit:${buildRateLimitSubject(ip, identifier)}`;
}

function getRateLimitMetaKey(redisKey: string): string {
  return `ratelimit-meta:${redisKey.replace(/^ratelimit:/, '')}`;
}

function buildRateLimitMetadata(ip: string, config: RateLimitConfig): RateLimitMetadata {
  return {
    scope: ip,
    identifier: config.identifier ?? null,
    limit: config.maxRequests,
    windowMs: config.windowMs,
    updatedAt: Date.now(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseRateLimitMetadata(value: unknown): RateLimitMetadata | null {
  if (typeof value !== 'string') {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);
    if (!isRecord(parsed)) {
      return null;
    }

    const scope = readString(parsed.scope);
    const identifier = parsed.identifier === null ? null : readString(parsed.identifier);
    const limit = readNumber(parsed.limit);
    const windowMs = readNumber(parsed.windowMs);
    const updatedAt = readNumber(parsed.updatedAt);

    if (!scope || limit === null || windowMs === null || updatedAt === null) {
      return null;
    }

    return {
      scope,
      identifier,
      limit,
      windowMs,
      updatedAt,
    };
  } catch {
    return null;
  }
}

function normalizeCounter(value: unknown): number | null {
  const count = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : Number.NaN;

  return Number.isFinite(count) ? count : null;
}

function getRateLimitStatus(count: number, limit: number | null): RateLimitSession['status'] {
  if (limit === null) {
    return 'unknown';
  }

  if (count > limit) {
    return 'limited';
  }

  if (count === limit) {
    return 'at_limit';
  }

  return 'tracking';
}

function createRateLimitSession(input: {
  key: string;
  storage: RateLimitSession['storage'];
  scope: string;
  identifier: string | null;
  count: number;
  limit: number | null;
  windowMs: number | null;
  reset: number | null;
  ttlSeconds: number | null;
  updatedAt: number | null;
}): RateLimitSession {
  return {
    id: input.key,
    key: input.key,
    storage: input.storage,
    scope: input.scope,
    identifier: input.identifier,
    count: input.count,
    limit: input.limit,
    remaining: input.limit === null ? null : Math.max(0, input.limit - input.count),
    reset: input.reset,
    ttlSeconds: input.ttlSeconds,
    windowMs: input.windowMs,
    updatedAt: input.updatedAt,
    status: getRateLimitStatus(input.count, input.limit),
  };
}

function sortRateLimitSessions(sessions: RateLimitSession[]): RateLimitSession[] {
  return sessions.sort((a, b) => {
    const statusWeight: Record<RateLimitSession['status'], number> = {
      limited: 0,
      at_limit: 1,
      tracking: 2,
      unknown: 3,
    };

    const statusDiff = statusWeight[a.status] - statusWeight[b.status];
    if (statusDiff !== 0) {
      return statusDiff;
    }

    return b.count - a.count;
  });
}

async function getRedisRateLimitSession(redis: RedisRateLimitClient, key: string): Promise<RateLimitSession | null> {
  if (!key.startsWith('ratelimit:') || key.startsWith('ratelimit-meta:')) {
    return null;
  }

  const [countValue, ttl, metadataValue] = await Promise.all([
    redis.get(key),
    redis.ttl(key),
    redis.get(getRateLimitMetaKey(key)),
  ]);
  const count = normalizeCounter(countValue);

  if (count === null || ttl === -2) {
    return null;
  }

  const metadata = parseRateLimitMetadata(metadataValue);
  const ttlSeconds = ttl > 0 ? ttl : null;
  const reset = ttlSeconds === null ? null : Date.now() + ttlSeconds * 1000;
  const fallbackScope = key.replace(/^ratelimit:/, '');

  return createRateLimitSession({
    key,
    storage: 'redis',
    scope: metadata?.scope ?? fallbackScope,
    identifier: metadata?.identifier ?? null,
    count,
    limit: metadata?.limit ?? null,
    windowMs: metadata?.windowMs ?? null,
    reset,
    ttlSeconds,
    updatedAt: metadata?.updatedAt ?? null,
  });
}

function getMemoryRateLimitSession(key: string): RateLimitSession | null {
  const entry = store[key];
  if (!entry) {
    return null;
  }

  const now = Date.now();
  if (entry.resetTime < now) {
    delete store[key];
    return null;
  }

  return createRateLimitSession({
    key,
    storage: 'memory',
    scope: entry.scope,
    identifier: entry.identifier,
    count: entry.count,
    limit: entry.limit,
    windowMs: entry.windowMs,
    reset: entry.resetTime,
    ttlSeconds: Math.max(0, Math.ceil((entry.resetTime - now) / 1000)),
    updatedAt: entry.updatedAt,
  });
}

/**
 * Check if a request should be rate limited (Redis-backed for production)
 * @param ip - Client IP address
 * @param config - Rate limit configuration
 * @returns RateLimitResult indicating if request is allowed
 */
export async function checkRateLimitAsync(ip: string, config: RateLimitConfig): Promise<RateLimitResult> {
  const key = buildRedisRateLimitKey(ip, config.identifier);
  const redis = await getRedisClient();

  if (redis) {
    try {
      const current = await redis.incr(key);

      if (current === 1) {
        await redis.expire(key, Math.ceil(config.windowMs / 1000));
      }

      const ttl = await redis.ttl(key);
      const ttlSeconds = ttl > 0 ? ttl : Math.ceil(config.windowMs / 1000);
      const resetTime = Date.now() + (ttlSeconds * 1000);
      await redis.setWithExpiry(
        getRateLimitMetaKey(key),
        JSON.stringify(buildRateLimitMetadata(ip, config)),
        ttlSeconds
      );

      return {
        success: current <= config.maxRequests,
        limit: config.maxRequests,
        remaining: Math.max(0, config.maxRequests - current),
        reset: resetTime,
      };
    } catch (error) {
      redisClient = null;
      console.error('[RateLimit] Redis error during rate-limit check:', error);
      throw new RateLimitUnavailableError();
    }
  }

  const now = Date.now();
  const memKey = buildRateLimitSubject(ip, config.identifier);

  let entry = store[memKey];

  if (!entry || entry.resetTime < now) {
    entry = {
      count: 0,
      resetTime: now + config.windowMs,
      scope: ip,
      identifier: config.identifier ?? null,
      limit: config.maxRequests,
      windowMs: config.windowMs,
      updatedAt: now,
    };
    store[memKey] = entry;
  }

  entry.scope = ip;
  entry.identifier = config.identifier ?? null;
  entry.limit = config.maxRequests;
  entry.windowMs = config.windowMs;
  entry.updatedAt = now;

  entry.count++;

  const remaining = Math.max(0, config.maxRequests - entry.count);
  const success = entry.count <= config.maxRequests;

  return {
    success,
    limit: config.maxRequests,
    remaining,
    reset: entry.resetTime,
  };
}

/**
 * Check if a request should be rate limited (synchronous wrapper)
 * For backward compatibility - delegates to async implementation
 * @param ip - Client IP address
 * @param config - Rate limit configuration
 * @returns RateLimitResult indicating if request is allowed
 */
export function checkRateLimit(ip: string, config: RateLimitConfig): RateLimitResult {
  const now = Date.now();
  const key = buildRateLimitSubject(ip, config.identifier);

  let entry = store[key];

  if (!entry || entry.resetTime < now) {
    entry = {
      count: 0,
      resetTime: now + config.windowMs,
      scope: ip,
      identifier: config.identifier ?? null,
      limit: config.maxRequests,
      windowMs: config.windowMs,
      updatedAt: now,
    };
    store[key] = entry;
  }

  entry.scope = ip;
  entry.identifier = config.identifier ?? null;
  entry.limit = config.maxRequests;
  entry.windowMs = config.windowMs;
  entry.updatedAt = now;

  entry.count++;

  const remaining = Math.max(0, config.maxRequests - entry.count);
  const success = entry.count <= config.maxRequests;

  return {
    success,
    limit: config.maxRequests,
    remaining,
    reset: entry.resetTime,
  };
}

export async function listRateLimitSessions(): Promise<RateLimitSession[]> {
  const redis = await getRedisClient();

  if (redis) {
    try {
      const keys = await redis.scanKeys('ratelimit:*');
      const sessions = await Promise.all(
        keys.map((key) => getRedisRateLimitSession(redis, key))
      );

      return sortRateLimitSessions(
        sessions.filter((session): session is RateLimitSession => session !== null)
      );
    } catch (error) {
      redisClient = null;
      console.error('[RateLimit] Redis error during rate-limit list:', error);
      throw new RateLimitUnavailableError();
    }
  }

  return sortRateLimitSessions(
    Object.keys(store)
      .map(getMemoryRateLimitSession)
      .filter((session): session is RateLimitSession => session !== null)
  );
}

export async function getRateLimitSession(key: string): Promise<RateLimitSession | null> {
  const redis = await getRedisClient();

  if (redis) {
    try {
      return getRedisRateLimitSession(redis, key);
    } catch (error) {
      redisClient = null;
      console.error('[RateLimit] Redis error during rate-limit lookup:', error);
      throw new RateLimitUnavailableError();
    }
  }

  return getMemoryRateLimitSession(key);
}

export async function releaseRateLimitSession(key: string): Promise<RateLimitSession | null> {
  const redis = await getRedisClient();

  if (redis) {
    try {
      const session = await getRedisRateLimitSession(redis, key);
      if (!session) {
        return null;
      }

      await Promise.all([
        redis.del(key),
        redis.del(getRateLimitMetaKey(key)),
      ]);

      return session;
    } catch (error) {
      redisClient = null;
      console.error('[RateLimit] Redis error during rate-limit release:', error);
      throw new RateLimitUnavailableError();
    }
  }

  const session = getMemoryRateLimitSession(key);
  if (!session) {
    return null;
  }

  delete store[key];
  return session;
}

/**
 * Get client IP from request headers
 * Trusts proxy headers only when TRUST_PROXY_HEADERS=true.
 */
export function getClientIp(request: Request): string {
  if (process.env.TRUST_PROXY_HEADERS === 'true') {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
      const hops = forwarded.split(',').map((hop) => hop.trim()).filter(Boolean);
      return hops[hops.length - 1] || 'unknown';
    }

    const realIp = request.headers.get('x-real-ip');
    if (realIp) {
      return realIp.trim() || 'unknown';
    }

    const vercelIp = request.headers.get('x-vercel-forwarded-for');
    if (vercelIp) {
      const hops = vercelIp.split(',').map((hop) => hop.trim()).filter(Boolean);
      return hops[hops.length - 1] || 'unknown';
    }
  }

  // Check for Next.js specific ip property
  const requestWithIp = request as Request & { ip?: string };
  if (requestWithIp.ip) {
    return requestWithIp.ip;
  }

  return 'unknown';
}

/**
 * Require a usable client IP for public mutation rate limits.
 *
 * In local development, Next.js may not expose a socket address, so keep local
 * routes usable. In production, never collapse all users into an "unknown"
 * shared bucket; fail closed until the deployment provides trusted proxy IP
 * headers or another request.ip source.
 */
export function getRequiredClientIp(request: Request): string {
  const clientIp = getClientIp(request);

  if (clientIp !== 'unknown') {
    return clientIp;
  }

  if (process.env.NODE_ENV !== 'production') {
    return 'local-development';
  }

  throw new ClientIpUnavailableError();
}

/**
 * Preset rate limit configurations for common use cases
 */
export const RateLimitPresets = {
  /**
   * Login attempts: 20 per 15 minutes (increased to accommodate typos)
   */
  login: {
    maxRequests: Number.parseInt(process.env.AUTH_LOGIN_MAX_ATTEMPTS || '20', 10),
    windowMs: Number.parseInt(process.env.AUTH_LOGIN_WINDOW_MS || String(15 * 60 * 1000), 10),
  },

  /**
   * Request submissions: 5 per hour
   */
  requestSubmission: {
    maxRequests: 5,
    windowMs: 60 * 60 * 1000,
  },

  /**
   * Password reset: 5 per hour
   */
  passwordReset: {
    maxRequests: 5,
    windowMs: 60 * 60 * 1000,
  },

  /**
   * Verification: 30 per hour
   */
  verification: {
    maxRequests: 30,
    windowMs: 60 * 60 * 1000,
  },

  /**
   * Admin operations: 400 per minute
   */
  adminOperations: {
    maxRequests: 400,
    windowMs: 60 * 1000,
  },

  /** Message-template tests send real SMTP mail to the current administrator. */
  messageTemplateTest: {
    maxRequests: 5,
    windowMs: 60 * 60 * 1000,
  },

  /**
   * General API: 200 per minute
   */
  general: {
    maxRequests: 200,
    windowMs: 60 * 1000,
  },
} as const;
