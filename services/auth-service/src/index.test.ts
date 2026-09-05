import { EventEmitter } from 'node:events';
import { afterEach, afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Boots the REAL service entrypoint under hermetic doubles for its edge
 * dependencies only (Redis, Prisma, oidc-provider internals, LDAP/TLS
 * transport, Cloudflare siteverify). Everything else - routing, taxonomy,
 * lockouts, sidecars, backchannel semantics - is production code.
 */

process.env.AUTH_ISSUER = 'https://auth.example.test';
process.env.AUTH_PORT = '0';
process.env.DATABASE_URL = 'postgres://db.invalid:5432/db';
process.env.AUTH_COOKIE_KEYS = 'test-cookie-key-at-least-32-characters';
delete process.env.OIDC_CLIENT_ID; // default bootstrap id: uar-portal
process.env.OIDC_CLIENT_SECRET = 'portal-shared-secret';
process.env.LDAP_DOMAIN = 'ad.example.test';
process.env.LDAP_URL = 'ldaps://dc01.ad.example.test:636';
process.env.LDAP_SEARCH_BASE = 'DC=ad,DC=example,DC=test';
process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY = 'turnstile-site-key';
process.env.TURNSTILE_SECRET_KEY = 'turnstile-secret-key';
process.env.AUTH_ADMIN_USERNAMES = 'admin';

const INVALID_CREDENTIALS_MESSAGE = 'Invalid username or password.';
const GENERIC_CHANGE_PASSWORD_ERROR =
  'All fields are required and the new password must be at least 8 characters.';

const harness = vi.hoisted(() => {
  return {
    redisStore: new Map<string, string>(),
    /** Keys the fake Lua script has "given" a TTL to. */
    redisTtlKeys: new Set<string>(),
    failRedisEval: false,
    failRedisDel: false,
    auditRows: [] as Array<Record<string, unknown>>,
    failAuditCreate: false,
    finishedLogins: [] as Array<{
      result: Record<string, unknown>;
      mergeWithLastSubmission?: boolean;
    }>,
    authorizationSuccessHandler: undefined as undefined | ((context: unknown) => void),
    grantsSaved: [] as Array<unknown>,
    localAccountRow: null as Record<string, unknown> | null,
    oidcClientName: 'UAR Portal' as string | null,
    localAccountLookups: 0,
    localAccountUpdates: [] as Array<{ where: unknown; data: Record<string, unknown> }>,
    interactionDetailsError: true,
    interactionPromptName: 'login',
    ldapClientsConstructed: 0,
    ldapBindImpl:
      undefined as undefined | ((upn: string, password: string) => Promise<void>),
    ldapSearchImpl:
      undefined as
        | undefined
        | ((
            base: string,
            options: { scope?: string; filter?: string; attributes?: string[] }
          ) => Promise<{ searchEntries: Array<Record<string, unknown>> }>),
    ldapModifyImpl: undefined as undefined | ((dn: string, changes: unknown[]) => Promise<void>),
    modifyCalls: [] as Array<{ dn: string; changes: unknown[] }>,
    tlsOutcome: 'error' as 'secureConnect' | 'error',
    requestHandler: undefined as undefined | ((req: unknown, res: unknown) => Promise<void>),
    providerCallbackCalls: 0,
  };
});

vi.mock('./db', () => ({
  withSessionAdvisoryLock: async (_key: string, work: () => Promise<unknown>) => work(),
  prisma: {
    $connect: async () => {},
    $queryRawUnsafe: async () => [{ attestation: null }],
    auditLog: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        if (harness.failAuditCreate) throw new Error('audit unavailable');
        harness.auditRows.push(data);
        return data;
      },
    },
    localAccount: {
      findFirst: async () => {
        harness.localAccountLookups += 1;
        return harness.localAccountRow;
      },
      update: async ({ where, data }: { where: unknown; data: Record<string, unknown> }) => {
        harness.localAccountUpdates.push({ where, data });
        return {};
      },
    },
    oidcClient: {
      findMany: async () => [],
      findUnique: async () => harness.oidcClientName === null ? null : { name: harness.oidcClientName },
    },
    authBrandingProfile: {
      findUnique: async () => null,
    },
  },
}));

vi.mock('redis', () => ({
  createClient: () => ({
    connect: async () => undefined,
    get: async (key: string) => harness.redisStore.get(key) ?? null,
    set: async (key: string, value: string, options?: { NX?: boolean }) => {
      if (options?.NX && harness.redisStore.has(key)) return null;
      harness.redisStore.set(key, String(value));
      return 'OK';
    },
    del: async (...keys: string[]) => {
      if (harness.failRedisDel) throw new Error('redis down');
      let removed = 0;
      for (const key of keys) if (harness.redisStore.delete(key)) removed += 1;
      return removed;
    },
    incr: async (key: string) => {
      const next = (Number.parseInt(harness.redisStore.get(key) ?? '0', 10) || 0) + 1;
      harness.redisStore.set(key, String(next));
      return next;
    },
    expire: async () => 1,
    // Mirrors the fixed-window Lua script: INCR + EXPIRE-once, atomically.
    eval: async (
      _script: string,
      options: { keys: string[]; arguments: string[] }
    ): Promise<number> => {
      if (harness.failRedisEval) throw new Error('redis down');
      const key = options.keys[0];
      if (key.startsWith('oidc:lock:')) {
        const [lockKey, targetKey] = options.keys;
        const [token, value] = options.arguments;
        if (harness.redisStore.get(lockKey) !== token) {
          return _script.includes('return -1') ? -1 : 0;
        }
        if (_script.includes("redis.call('pexpire'")) return 1;
        if (targetKey && _script.includes("redis.call('set'")) {
          harness.redisStore.set(targetKey, value);
          return 1;
        }
        if (targetKey) return harness.redisStore.delete(targetKey) ? 1 : 0;
        return harness.redisStore.delete(lockKey) ? 1 : 0;
      }
      const next = (Number.parseInt(harness.redisStore.get(key) ?? '0', 10) || 0) + 1;
      harness.redisStore.set(key, String(next));
      if (!harness.redisTtlKeys.has(key)) harness.redisTtlKeys.add(key);
      return next;
    },
    scanIterator: async function* (opts: { MATCH: string }) {
      const prefix = opts.MATCH.replace(/\*$/, '');
      for (const key of [...harness.redisStore.keys()]) {
        if (key.startsWith(prefix)) yield key;
      }
    },
  }),
}));

vi.mock('oidc-provider', () => {
  class PolicyCheck {
    static REQUEST_PROMPT = true;
    static NO_NEED_TO_PROMPT = false;
    constructor(
      public reason: string,
      public description: string,
      public check: (ctx: unknown) => boolean | Promise<boolean>,
    ) {}
  }
  return {
    interactionPolicy: {
      Check: PolicyCheck,
      base: () => {
        const checks: PolicyCheck[] & { add?: (check: PolicyCheck, index?: number) => void } = [];
        checks.add = (check, index = checks.length) => { checks.splice(index, 0, check); };
        const policy: Array<{ name: string; checks: typeof checks }> & {
          get?: (name: string) => { name: string; checks: typeof checks } | undefined;
        } = [{ name: 'login', checks }];
        policy.get = (name) => policy.find((prompt) => prompt.name === name);
        return policy;
      },
    },
    default: class Provider {
    proxy = false;
    constructor(
      public issuer: string,
      public options: Record<string, unknown>
    ) {}
    on(event: string, handler: (context: unknown) => void): this {
      if (event === 'authorization.success') harness.authorizationSuccessHandler = handler;
      return this;
    }
    async interactionDetails(): Promise<Record<string, unknown>> {
      if (harness.interactionDetailsError) {
        throw new Error('Invalid request: no interaction cookie');
      }
      return {
        prompt: { name: harness.interactionPromptName },
        params: { client_id: 'uar-portal', scope: 'openid' },
        session: { accountId: 'someone', uid: 'provider-session-uid' },
      };
    }
    async interactionFinished(
      _req: unknown,
      res: { writeHead(s: number, h?: Record<string, string>): unknown; end(): unknown },
      result: Record<string, unknown>,
      opts?: { mergeWithLastSubmission?: boolean }
    ): Promise<void> {
      harness.finishedLogins.push({ result, mergeWithLastSubmission: opts?.mergeWithLastSubmission });
      res.writeHead(302, { Location: '/auth/resume' });
      res.end();
    }
    Grant = class {
      payload: Record<string, unknown>;
      constructor(payload: Record<string, unknown>) {
        this.payload = payload;
      }
      addOIDCScope(): void {}
      async save(): Promise<string> {
        harness.grantsSaved.push(this.payload);
        return 'grant-id-1';
      }
    };
    callback() {
      return async (
        _req: unknown,
        res: { writeHead(s: number): unknown; end(b?: string): unknown }
      ): Promise<void> => {
        harness.providerCallbackCalls += 1;
        res.writeHead(404);
        res.end();
      };
    }
    },
  };
});

vi.mock('ldapts', () => {
  class Attribute {
    type: string;
    values: Buffer[];
    constructor(input: { type: string; values: Buffer[] }) {
      this.type = input.type;
      this.values = input.values;
    }
  }
  class Change {
    operation: string;
    modification: Attribute;
    constructor(input: { operation: string; modification: Attribute }) {
      this.operation = input.operation;
      this.modification = input.modification;
    }
  }
  class Client {
    readonly options: unknown;
    constructor(options: unknown) {
      this.options = options;
      harness.ldapClientsConstructed += 1;
    }
    async bind(upn: string, password: string): Promise<void> {
      await harness.ldapBindImpl?.(upn, password);
    }
    async search(
      base: string,
      options: { scope?: string; filter?: string; attributes?: string[] }
    ): Promise<{ searchEntries: Array<Record<string, unknown>> }> {
      return harness.ldapSearchImpl?.(base, options) ?? { searchEntries: [] };
    }
    async modify(dn: string, changes: unknown[]): Promise<void> {
      harness.modifyCalls.push({ dn, changes });
      await harness.ldapModifyImpl?.(dn, changes);
    }
    async unbind(): Promise<void> {}
  }
  return { Attribute, Change, Client };
});

vi.mock('tls', () => {
  const connect = (): unknown => {
    const listeners = new Map<string, Array<() => void>>();
    const socket = {
      once(event: string, cb: () => void): void {
        const bucket = listeners.get(event) ?? [];
        bucket.push(cb);
        listeners.set(event, bucket);
      },
      destroy(): void {},
      fire(event: string): void {
        for (const cb of listeners.get(event) ?? []) cb();
      },
    };
    queueMicrotask(() => socket.fire(harness.tlsOutcome));
    return socket;
  };
  return { connect, default: { connect } };
});

vi.mock('node:http', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:http')>();
  const captureServer = (handler: (req: unknown, res: unknown) => Promise<void>): unknown => {
    harness.requestHandler = handler;
    return {
      listen: (_port: number, cb?: () => void) => {
        cb?.();
      },
      close: () => {},
    };
  };
  const fakeModule: Record<string, unknown> = {
    ...(actual as unknown as Record<string, unknown>),
    createServer: captureServer,
    default: {
      ...((actual as unknown as { default?: Record<string, unknown> }).default ?? {}),
      createServer: captureServer,
    },
  };
  return fakeModule;
});

beforeAll(async () => {
  await import('./index');
  const deadline = Date.now() + 5000;
  while (!harness.requestHandler && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!harness.requestHandler) {
    throw new Error('auth service did not finish booting under mocks');
  }
});

afterAll(() => {
  for (const name of [
    'AUTH_ISSUER',
    'AUTH_PORT',
    'DATABASE_URL',
    'AUTH_COOKIE_KEYS',
    'OIDC_CLIENT_SECRET',
    'LDAP_DOMAIN',
    'LDAP_URL',
    'LDAP_SEARCH_BASE',
    'NEXT_PUBLIC_TURNSTILE_SITE_KEY',
    'TURNSTILE_SECRET_KEY',
    'AUTH_ADMIN_USERNAMES',
  ]) {
    delete process.env[name];
  }
});

class FakeRequest extends EventEmitter {
  url: string;
  method: string;
  headers: Record<string, string>;
  socket = { remoteAddress: '127.0.0.1' };

  constructor(
    url: string,
    options: { method?: string; headers?: Record<string, string>; body?: string } = {}
  ) {
    super();
    this.url = url;
    this.method = options.method ?? 'GET';
    this.headers = { 'user-agent': 'vitest-agent', ...(options.headers ?? {}) };
    const body = options.body;
    if (body !== undefined) {
      const deliver = (attempt: number): void => {
        if (this.listenerCount('end') > 0 && this.listenerCount('data') > 0) {
          this.emit('data', Buffer.from(body));
          this.emit('end');
          return;
        }
        if (attempt > 500) return;
        setImmediate(() => deliver(attempt + 1));
      };
      setImmediate(() => deliver(0));
    }
  }

  destroy(): void {}
}

interface CapturedResponse {
  status: number | undefined;
  headers: Record<string, string>;
  body: string;
  ended: boolean;
}

function fakeResponse(): { res: ServerResponse; state: CapturedResponse } {
  const state: CapturedResponse = { status: undefined, headers: {}, body: '', ended: false };
  const res = {
    writeHead(status: number, headers?: Record<string, string>): typeof res {
      state.status = status;
      Object.assign(state.headers, headers ?? {});
      return res;
    },
    end(chunk?: string | Buffer): typeof res {
      if (chunk !== undefined) state.body += chunk.toString();
      state.ended = true;
      return res;
    },
    get writableEnded(): boolean {
      return state.ended;
    },
    destroy(): void {},
  };
  return { res: res as unknown as ServerResponse, state };
}

interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  /** Object bodies are form-encoded; strings are delivered verbatim (JSON). */
  body?: Record<string, string> | string;
}

async function request(path: string, options: RequestOptions = {}): Promise<CapturedResponse> {
  const { method, headers, body } = options;
  const encoded =
    body === undefined
      ? undefined
      : typeof body === 'string'
        ? body
        : new URLSearchParams(body).toString();
  const req = new FakeRequest(path, { method, headers, body: encoded });
  const { res, state } = fakeResponse();
  await harness.requestHandler?.(req as unknown as IncomingMessage, res);
  return state;
}

function basicAuth(id = 'uar-portal', secret = 'portal-shared-secret'): string {
  return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
}

const adError = (dataCode: string): Error =>
  new Error(
    `80090308: LdapErr: DSID-0C090447, comment: AcceptSecurityContext error, data ${dataCode}, v3839`
  );

function stubTurnstileFetch(verdict: boolean): void {
  vi.stubGlobal(
    'fetch',
    async (): Promise<unknown> => ({ ok: true, json: async () => ({ success: verdict }) })
  );
}

function loginForm(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    username: 'Alice',
    password: 'correct-horse',
    'cf-turnstile-response': 'turnstile-token',
    ...overrides,
  };
}

/** Seed an engaged per-account lockout counter for the current fixed window. */
function engageAccountLockout(username: string, attempts = 5): void {
  const bucket = Math.floor(Date.now() / 900000);
  harness.redisStore.set(`authrl:acctlock:${encodeURIComponent(username)}:${bucket}`, String(attempts));
}

/** Exhaust the per-IP login limiter for the current fixed window. */
function engageRateLimit(ip: string, max = 20): void {
  const bucket = Math.floor(Date.now() / 900000);
  harness.redisStore.set(`authrl:login:${ip}:${bucket}`, String(max));
}

function auditRow(action: string, outcome?: string): Record<string, unknown> | undefined {
  return harness.auditRows.find(
    (row) => row.action === action && (outcome === undefined || row.outcome === outcome)
  );
}

beforeEach(() => {
  harness.redisStore.clear();
  harness.redisTtlKeys.clear();
  harness.failRedisEval = false;
  harness.failRedisDel = false;
  harness.auditRows.length = 0;
  harness.failAuditCreate = false;
  harness.finishedLogins.length = 0;
  harness.grantsSaved.length = 0;
  harness.localAccountRow = null;
  harness.oidcClientName = 'UAR Portal';
  harness.localAccountLookups = 0;
  harness.localAccountUpdates.length = 0;
  harness.interactionDetailsError = true;
  harness.interactionPromptName = 'login';
  harness.ldapClientsConstructed = 0;
  harness.ldapBindImpl = async () => {};
  harness.ldapSearchImpl = async () => ({ searchEntries: [] });
  harness.ldapModifyImpl = async () => {};
  harness.modifyCalls.length = 0;
  harness.tlsOutcome = 'error';
  harness.providerCallbackCalls = 0;
  stubTurnstileFetch(true);
});

afterEach(() => {
  delete process.env.PORTAL_CLONE_READ_ONLY;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('production-clone provider containment', () => {
  it('rejects RP-initiated end_session before oidc-provider can emit back-channel requests', async () => {
    process.env.PORTAL_CLONE_READ_ONLY = 'true';
    const res = await request('/session/end_session', { method: 'GET' });

    expect(res.status).toBe(403);
    expect(res.body).toContain('disabled_in_clone_mode');
    expect(harness.providerCallbackCalls).toBe(0);
  });
});

describe('GET /admin/api/identity-configuration', () => {
  it('rejects an anonymous request at the real admin router', async () => {
    const res = await request('/admin/api/identity-configuration');

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'unauthenticated' });
  });
});

describe('GET /ui/font assets', () => {
  it.each([
    '/ui/fonts/geist-v1-latin.woff2',
    '/ui/fonts/geist-mono-v1-latin.woff2',
  ])('serves %s with immutable same-origin headers', async (path) => {
    const res = await request(path);
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('font/woff2');
    expect(res.headers['Cache-Control']).toContain('immutable');
    expect(res.headers['Cross-Origin-Resource-Policy']).toBe('same-origin');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
    expect(res.body.length).toBeGreaterThan(1000);
  });

  it('does not turn the font prefix into a filesystem router', async () => {
    const res = await request('/ui/fonts/not-packaged.woff2');
    expect(res.status).toBe(404);
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('rejects non-GET methods before loading an asset', async () => {
    const res = await request('/ui/fonts/geist-v1-latin.woff2', { method: 'POST' });
    expect(res.status).toBe(405);
    expect(res.headers.Allow).toBe('GET');
  });
});

describe('POST /interaction/:uid credential login', () => {
  it('mints a provider session on valid AD credentials and writes the sidecars', async () => {
    harness.interactionDetailsError = false;
    const boundUpns: string[] = [];
    harness.ldapBindImpl = async (upn) => {
      boundUpns.push(upn);
    };

    const res = await request('/interaction/uidlogin1', {
      method: 'POST',
      body: loginForm(),
    });

    expect(res.status).toBe(302);
    expect(harness.finishedLogins).toHaveLength(1);
    expect(harness.finishedLogins[0]?.result.login).toEqual({ accountId: 'alice', amr: ['ad'] });
    expect(harness.finishedLogins[0]?.mergeWithLastSubmission).toBe(true);
    // UPN construction happened against the configured domain.
    expect(boundUpns).toEqual(['alice@ad.example.test']);
    // The cache contains descriptive profile data only. Authentication
    // authority is bound to the provider Session result above.
    const ordinaryClaims = JSON.parse(harness.redisStore.get('authsvc:claims:alice') ?? '{}');
    expect(ordinaryClaims).toEqual({});
    expect('amr' in ordinaryClaims).toBe(false);
    expect('pwd_changed' in ordinaryClaims).toBe(false);
    // Sign-in context stash for the tracking adapter (ADR-0014).
    const lastLogin = JSON.parse(harness.redisStore.get('authsvc:loginctx:alice:uidlogin1') ?? '{}');
    expect(lastLogin.clientId).toBe('uar-portal');
    expect(lastLogin.ip).toBe('127.0.0.1');
    expect(lastLogin.userAgent).toBe('vitest-agent');
    harness.authorizationSuccessHandler?.({
      oidc: {
        session: { jti: 'fresh-session-jti', accountId: 'alice', exp: Math.floor(Date.now() / 1000) + 3600 },
        entities: { Interaction: { uid: 'uidlogin1' } },
      },
    });
    await vi.waitFor(() => {
      expect(harness.redisStore.get('authsvc:sessmeta:fresh-session-jti')).toBeTruthy();
    });
    expect(JSON.parse(harness.redisStore.get('authsvc:sessmeta:fresh-session-jti') ?? '{}')).toMatchObject({
      clientId: 'uar-portal', ip: '127.0.0.1', userAgent: 'vitest-agent',
    });
    expect(auditRow('LOGIN_SUCCESS')).toMatchObject({
      username: 'alice',
      outcome: 'success',
    });
  });

  it('normalizes usernames before every downstream step', async () => {
    const boundUpns: string[] = [];
    harness.ldapBindImpl = async (upn) => {
      boundUpns.push(upn);
    };
    await request('/interaction/uidnorm1', {
      method: 'POST',
      body: loginForm({ username: '  Alice@AD.Example.TEST ' }),
    });
    expect(boundUpns).toEqual(['alice@ad.example.test']);
  });

  it('does not finish a user session when the success audit cannot persist', async () => {
    harness.interactionDetailsError = false;
    harness.failAuditCreate = true;

    const res = await request('/interaction/uidaudit1', {
      method: 'POST',
      body: loginForm(),
    });

    expect(res.status).toBe(500);
    expect(harness.finishedLogins).toHaveLength(0);
  });

  it.each([
    ['52e', 'invalid_credentials'],
    ['533', 'account_disabled'],
    ['775', 'account_locked'],
    ['701', 'account_expired'],
    ['531', 'account_restricted'],
  ])(
    'presents AD sub-error %s with the uniform generic message and no state leak',
    async (code, expectedOutcome) => {
      harness.ldapBindImpl = async () => {
        throw adError(code);
      };

      const res = await request('/interaction/uiddeny1', {
        method: 'POST',
        body: loginForm(),
      });

      expect(res.status).toBe(401);
      expect(res.body).toContain(INVALID_CREDENTIALS_MESSAGE);
      expect(res.body.toLowerCase()).not.toContain('disabled');
      expect(res.body.toLowerCase()).not.toContain('locked');
      expect(res.body.toLowerCase()).not.toContain('expired');
      expect(auditRow('LOGIN_FAILED', expectedOutcome)).toMatchObject({ username: 'alice' });
    }
  );

  it('counts wrong-password failures toward the per-account lockout', async () => {
    harness.ldapBindImpl = async () => {
      throw adError('52e');
    };
    await request('/interaction/uidcount1', { method: 'POST', body: loginForm() });
    const bucket = Math.floor(Date.now() / 900000);
    expect(harness.redisStore.get(`authrl:acctlock:alice:${bucket}`)).toBe('1');
  });

  it.each([
    ['533', 'account_disabled'],
    ['775', 'account_locked'],
    ['701', 'account_expired'],
    ['531', 'account_restricted'],
  ])(
    'does NOT count policy denial %s toward the per-account brute-force counter',
    async (code) => {
      harness.ldapBindImpl = async () => {
        throw adError(code);
      };
      await request('/interaction/uidpolicy1', { method: 'POST', body: loginForm() });
      const bucket = Math.floor(Date.now() / 900000);
      // Only wrong passwords feed the lockout; policy denials never do.
      expect(harness.redisStore.get(`authrl:acctlock:alice:${bucket}`)).toBeUndefined();
      expect(auditRow('LOGIN_FAILED')).toMatchObject({ username: 'alice' });
    }
  );

  it('never queries a local credential store when Active Directory is unavailable', async () => {
    harness.ldapBindImpl = async () => {
      throw new Error('15000ms timed out');
    };
    const res = await request('/interaction/uidbg1', {
      method: 'POST',
      body: loginForm({ password: 'any-password' }),
    });

    expect(res.status).toBe(503);
    expect(harness.localAccountLookups).toBe(0);
    expect(harness.localAccountUpdates).toHaveLength(0);
    expect(harness.finishedLogins).toHaveLength(0);
    expect(auditRow('LOGIN_FAILED', 'unavailable')).toMatchObject({
      details: expect.stringContaining('"method":"ad"'),
    });
  });

  it('never consults break-glass on policy denials (unknown_error while reachable)', async () => {
    harness.tlsOutcome = 'secureConnect'; // directory IS reachable
    harness.ldapBindImpl = async () => {
      throw new Error('serverDownResult');
    };

    const res = await request('/interaction/uidbg2', {
      method: 'POST',
      body: loginForm(),
    });

    expect(res.status).toBe(503);
    expect(harness.localAccountLookups).toBe(0);
    expect(harness.finishedLogins).toHaveLength(0);
  });

  it('falls back to 503 when transport fails AND no break-glass identity matches', async () => {
    harness.ldapBindImpl = async () => {
      throw new Error('connect timed out');
    };
    harness.localAccountRow = null;

    const res = await request('/interaction/uidbg3', {
      method: 'POST',
      body: loginForm(),
    });

    expect(res.status).toBe(503);
    expect(res.body).toContain('Sign-in is temporarily unavailable.');
  });

  it('presents engaged per-account lockouts byte-identically to wrong-password responses', async () => {
    // Reference response: genuine wrong password.
    harness.ldapBindImpl = async () => {
      throw adError('52e');
    };
    const reference = await request('/interaction/uidbyteeq', {
      method: 'POST',
      body: loginForm(),
    });
    const clientsAfterReference = harness.ldapClientsConstructed;

    // Engaged lockout: AD must never even be consulted.
    engageAccountLockout('alice');
    const locked = await request('/interaction/uidbyteeq', {
      method: 'POST',
      body: loginForm(),
    });

    expect(locked.status).toBe(reference.status);
    expect(locked.body).toBe(reference.body);
    expect(harness.ldapClientsConstructed).toBe(clientsAfterReference);
    expect(auditRow('LOGIN_FAILED', 'account_lockout_engaged')).toBeDefined();
  });

  it('rate-limit-exceeded path responds 429 before touching AD, Turnstile, or audit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-06-01T08:00:00Z'));
    engageRateLimit('127.0.0.1');

    const res = await request('/interaction/uidrl1', {
      method: 'POST',
      body: loginForm(),
    });

    expect(res.status).toBe(429);
    expect(res.body).toContain('Too many sign-in attempts');
    expect(harness.ldapClientsConstructed).toBe(0);
    expect(harness.auditRows).toHaveLength(0);
  });

  it('fails closed when Turnstile verification is not completed', async () => {
    const res = await request('/interaction/uidts1', {
      method: 'POST',
      body: loginForm({ 'cf-turnstile-response': '' }),
    });

    expect(res.status).toBe(401);
    expect(res.body).toContain('Human verification failed');
    expect(harness.ldapClientsConstructed).toBe(0);
    expect(auditRow('LOGIN_FAILED', 'denied')).toMatchObject({ username: 'alice' });
  });

  it('rejects Cloudflare-negative Turnstile verdicts identically', async () => {
    stubTurnstileFetch(false);
    const res = await request('/interaction/uidts2', {
      method: 'POST',
      body: loginForm(),
    });
    expect(res.status).toBe(401);
    expect(harness.ldapClientsConstructed).toBe(0);
  });
});

describe('GET /interaction/:uid login page', () => {
  it('renders the branded page and mints a first-party device cookie once', async () => {
    harness.interactionDetailsError = false;

    const first = await request('/interaction/uidpage1');

    expect(first.status).toBe(200);
    expect(first.headers['Cache-Control']).toBe('no-store');
    expect(first.headers['X-Frame-Options']).toBe('DENY');
    expect(String(first.headers['Set-Cookie'])).toContain('authsvc_did=');
    expect(first.body).toContain('action="/interaction/uidpage1"');
    expect(first.body).toContain('turnstile-site-key');
    expect(first.body).toContain('<h1>Sign in to UAR Portal</h1>');

    const deviceCookie = 'aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000';
    const second = await request('/interaction/uidpage1', {
      headers: { cookie: `authsvc_did=${deviceCookie}` },
    });
    expect(second.headers['Set-Cookie']).toBeUndefined();
  });

  it('uses configured bootstrap presentation when the portal has no registry row', async () => {
    harness.interactionDetailsError = false;
    harness.oidcClientName = null;

    const response = await request('/interaction/uidbootstrap1');

    expect(response.status).toBe(200);
    expect(response.body).toContain('<h1>Sign in to UAR Portal</h1>');
    expect(response.body).not.toContain('your application');
  });

  it('answers unsupported methods with 405', async () => {
    const res = await request('/interaction/uidpage1', { method: 'DELETE' });
    expect(res.status).toBe(405);
  });
});

describe('forced-change flow through the interaction routes', () => {
  it.each([
    ['773', 'password_change_required'],
    ['532', 'password_expired'],
  ])('pins the triggering account to the interaction on %s (%s)', async (code) => {
    harness.ldapBindImpl = async () => {
      throw adError(code);
    };
    const uid = `uidchange${code}`;
    const res = await request(`/interaction/${uid}`, {
      method: 'POST',
      body: loginForm(),
    });
    expect(res.status).toBe(200);
    expect(res.body).toContain(`action="/interaction/${uid}/change-password"`);
    expect(res.body).toContain('value="alice"');
    expect(harness.redisStore.get(`authsvc:cpw:${uid}`)).toBe('alice');
  });

  it('refuses identity-mismatched change requests before contacting AD', async () => {
    const uid = 'uidbind1';
    harness.redisStore.set(`authsvc:cpw:${uid}`, 'alice');
    harness.interactionDetailsError = false;
    const clientsBefore = harness.ldapClientsConstructed;

    const res = await request(`/interaction/${uid}/change-password`, {
      method: 'POST',
      body: {
        username: 'mallory',
        current: 'whatever',
        next: 'brand-new-passphrase',
        confirm: 'brand-new-passphrase',
        'cf-turnstile-response': 'turnstile-token',
      },
    });

    expect(res.status).toBe(400);
    expect(res.body).toContain(GENERIC_CHANGE_PASSWORD_ERROR);
    expect(harness.ldapClientsConstructed).toBe(clientsBefore);
    expect(auditRow('LOGIN_FAILED', 'password_change_denied')).toMatchObject({
      username: 'mallory',
    });
    // The binding survives so the legitimate user can still complete it.
    expect(harness.redisStore.get(`authsvc:cpw:${uid}`)).toBe('alice');
  });

  it('completes a bound change, clears the binding, and mints the session', async () => {
    const uid = 'uidbind2';
    harness.redisStore.set(`authsvc:cpw:${uid}`, 'alice');
    harness.interactionDetailsError = false;
    harness.ldapSearchImpl = async (base) =>
      base === ''
        ? { searchEntries: [{ defaultNamingContext: 'DC=ad,DC=example,DC=test' }] }
        : { searchEntries: [{ dn: 'CN=Alice,DC=ad,DC=example,DC=test' }] };

    const res = await request(`/interaction/${uid}/change-password`, {
      method: 'POST',
      body: {
        username: ' Alice ',
        current: 'old-passphrase',
        next: 'brand-new-passphrase',
        confirm: 'brand-new-passphrase',
        'cf-turnstile-response': 'turnstile-token',
      },
    });

    expect(res.status).toBe(302);
    expect(harness.finishedLogins[0]?.result.login).toEqual({ accountId: 'alice', amr: ['ad', 'pwd_changed'] });
    expect(harness.redisStore.get(`authsvc:cpw:${uid}`)).toBeUndefined();
    expect(JSON.parse(harness.redisStore.get('authsvc:claims:alice') ?? '{}')).toEqual({});
    // delete+add sequence hit unicodePwd with quoted utf16le values.
    expect(harness.modifyCalls).toHaveLength(1);
    const changes = harness.modifyCalls[0]?.changes ?? [];
    const remove = changes[0] as { operation: string; modification: { values: Buffer[] } };
    const add = changes[1] as { operation: string; modification: { values: Buffer[] } };
    expect(remove.operation).toBe('delete');
    expect(add.operation).toBe('add');
    expect(Buffer.from(remove.modification.values[0]).toString('utf16le')).toBe('"old-passphrase"');
    expect(Buffer.from(add.modification.values[0]).toString('utf16le')).toBe('"brand-new-passphrase"');
    expect(auditRow('LOGIN_SUCCESS', 'password_changed')).toBeDefined();
  });

  it('counts a rejected CURRENT password toward the account lockout', async () => {
    const uid = 'uidbind3';
    harness.redisStore.set(`authsvc:cpw:${uid}`, 'alice');
    harness.interactionDetailsError = false;
    harness.ldapBindImpl = async (_upn, password) => {
      if (password !== 'right-current') throw adError('52e');
    };

    const res = await request(`/interaction/${uid}/change-password`, {
      method: 'POST',
      body: {
        username: 'alice',
        current: 'wrong-current',
        next: 'brand-new-passphrase',
        confirm: 'brand-new-passphrase',
        'cf-turnstile-response': 'turnstile-token',
      },
    });

    expect(res.status).toBe(400);
    expect(res.body).toContain('Current password was not accepted by Active Directory.');
    const bucket = Math.floor(Date.now() / 900000);
    expect(harness.redisStore.get(`authrl:acctlock:alice:${bucket}`)).toBe('1');
  });
});

describe('POST /session/backchannel-logout', () => {
  function seedPortalSession(sid: string, jti = 'jti-live'): void {
    harness.redisStore.set(
      `oidc:Session:${jti}`,
      JSON.stringify({
        jti,
        kind: 'Session',
        uid: `internal-${jti}`,
        accountId: 'alice',
        exp: Math.floor(Date.now() / 1000) + 3600,
        authorizations: { 'uar-portal': { sid, grantId: 'g1' }, 'other-app': { sid: 'sid-of-other-app' } },
      })
    );
    harness.redisStore.set(`oidc:Session:uid:internal-${jti}`, jti);
  }

  it('destroys the provider session matching the portal-recorded ID-token sid', async () => {
    seedPortalSession('sid-value-1234567890');

    const res = await request('/session/backchannel-logout', {
      method: 'POST',
      headers: { authorization: basicAuth() },
      body: { sid: 'sid-value-1234567890' },
    });

    expect(res.status).toBe(204);
    expect(harness.redisStore.has('oidc:Session:jti-live')).toBe(false);
    expect(harness.redisStore.has('oidc:Session:uid:internal-jti-live')).toBe(false);
    const row = auditRow('LOGOUT');
    expect(JSON.parse(String(row?.details))).toMatchObject({
      method: 'oidc_backchannel',
      sid: 'sid-value-1234567890',
      sessionDestroyed: true,
    });
  });

  it('answers 204 with honest no-match accounting for unknown sids', async () => {
    seedPortalSession('sid-value-1234567890');

    const res = await request('/session/backchannel-logout', {
      method: 'POST',
      headers: { authorization: basicAuth(), 'content-type': 'application/x-www-form-urlencoded' },
      body: { sid: 'unknown-sid-9876543' },
    });

    expect(res.status).toBe(204);
    // Form-encoded variant still destroyed nothing.
    expect(harness.redisStore.has('oidc:Session:jti-live')).toBe(true);
    const row = auditRow('LOGOUT');
    expect(JSON.parse(String(row?.details))).toMatchObject({ sessionDestroyed: false });
  });

  it('rejects invalid Basic credentials timing-safely and audits nothing', async () => {
    const res = await request('/session/backchannel-logout', {
      method: 'POST',
      headers: { authorization: basicAuth('uar-portal', 'not-the-secret') },
      body: { sid: 'sid-value-1234567890' },
    });

    expect(res.status).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'invalid_client' });
    expect(res.headers['WWW-Authenticate']).toContain('Basic realm=');
    expect(harness.auditRows).toHaveLength(0);
    expect(await request('/session/backchannel-logout', {
      method: 'POST',
      headers: { authorization: 'Bearer something' },
      body: { sid: 'sid-value-1234567890' },
    })).toMatchObject({ status: 401 });
  });

  it('400s malformed bodies behind valid credentials', async () => {
    for (const body of [{}, { sid: '../../etc/passwd' }, { sid: 'short' }]) {
      const res = await request('/session/backchannel-logout', {
        method: 'POST',
        headers: { authorization: basicAuth() },
        body,
      });
      expect(res.status).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ error: 'invalid_request' });
    }
  });

  it('reports 503 when the session cannot be destroyed, leaving state intact', async () => {
    seedPortalSession('sid-value-1234567890');
    harness.failRedisDel = true;

    const res = await request('/session/backchannel-logout', {
      method: 'POST',
      headers: { authorization: basicAuth() },
      body: { sid: 'sid-value-1234567890' },
    });

    expect(res.status).toBe(503);
    expect(JSON.parse(res.body)).toEqual({ error: 'temporarily_unavailable' });
    expect(harness.redisStore.has('oidc:Session:jti-live')).toBe(true);
    expect(harness.auditRows).toHaveLength(0);
  });

  it('rate-limits the shared-secret endpoint per source IP before auth (60/min)', async () => {
    const bucket = Math.floor(Date.now() / 60_000);
    harness.redisStore.set(`authrl:endpoint:backchannel-logout:127.0.0.1:${bucket}`, '60');

    // Even VALID credentials are refused with 429 once the IP window is full.
    const res = await request('/session/backchannel-logout', {
      method: 'POST',
      headers: { authorization: basicAuth() },
      body: { sid: 'sid-value-1234567890' },
    });
    expect(res.status).toBe(429);
    expect(JSON.parse(res.body)).toEqual({ error: 'rate_limited' });
    // The denial itself consumed one window slot.
    expect(harness.redisStore.get(`authrl:endpoint:backchannel-logout:127.0.0.1:${bucket}`)).toBe('61');
  });

  it('fails closed with 503 when the endpoint limiter cannot reach Redis', async () => {
    harness.failRedisEval = true;
    const res = await request('/session/backchannel-logout', {
      method: 'POST',
      headers: { authorization: basicAuth() },
      body: { sid: 'sid-value-1234567890' },
    });
    expect(res.status).toBe(503);
    expect(JSON.parse(res.body)).toEqual({ error: 'temporarily_unavailable' });
  });
});

describe('shared-secret /internal/clients endpoint', () => {
  it('rate-limits registry calls per source IP before auth (120/min)', async () => {
    const bucket = Math.floor(Date.now() / 60_000);
    harness.redisStore.set(`authrl:endpoint:internal-clients:127.0.0.1:${bucket}`, '120');

    const res = await request('/internal/clients', {
      method: 'GET',
      headers: { authorization: basicAuth() },
    });
    expect(res.status).toBe(429);
    expect(JSON.parse(res.body)).toEqual({ error: 'rate_limited' });
  });

  it('fails closed with 503 when Redis is unavailable', async () => {
    harness.failRedisEval = true;
    const res = await request('/internal/clients', {
      method: 'GET',
      headers: { authorization: basicAuth() },
    });
    expect(res.status).toBe(503);
    expect(JSON.parse(res.body)).toEqual({ error: 'temporarily_unavailable' });
  });

  it('still authenticates client credentials after an allowed request', async () => {
    const res = await request('/internal/clients', {
      method: 'GET',
      headers: { authorization: basicAuth('uar-portal', 'wrong') },
    });
    expect(res.status).toBe(401);
    expect(JSON.parse(res.body)).toEqual({ error: 'invalid_client' });
  });

  it('rejects unknown and offline_access scopes on create with a 400 detail', async () => {
    for (const scope of ['openid email offline_access', 'openid sudo']) {
      const res = await request('/internal/clients', {
        method: 'POST',
        headers: { authorization: basicAuth(), 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Scope Probe',
          redirectUris: ['https://probe.example.test/cb'],
          scope,
        }).toString(),
      });
      expect(res.status).toBe(400);
      const parsed = JSON.parse(res.body);
      expect(parsed.error).toBe('invalid_request');
      expect(parsed.detail).toContain(scope === 'openid email offline_access' ? 'offline_access' : 'sudo');
    }
  });

  it('rejects non-RS256 id_token_signed_response_alg on create', async () => {
    const res = await request('/internal/clients', {
      method: 'POST',
      headers: { authorization: basicAuth(), 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Alg Probe',
        redirectUris: ['https://probe.example.test/cb'],
        id_token_signed_response_alg: 'HS256',
      }).toString(),
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).detail).toContain('RS256');
  });
});
