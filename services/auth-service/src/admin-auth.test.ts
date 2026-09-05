import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_COOKIE_NAME,
  adminPrincipalFromRequest,
  adminUsernameFromRequest,
  handleAdminLogin,
  handleAdminLogout,
  renderAdminLoginPage,
  signAdminSession,
  verifyAdminSession,
} from './admin-auth';
import { mintAdminSessionRecord } from './admin-sessions';
import type { AuthConfig } from './config';
import { hashRecoveryPassword } from './admin-recovery';

const auditHarness = vi.hoisted(() => ({
  createImpl: async (): Promise<Record<string, never>> => ({}),
  recovery: null as null | {
    id: string;
    username: string;
    passwordHash: string;
    isActive: boolean;
    credentialVersion: number;
  },
}));

vi.mock('./db', () => ({
  prisma: {
    auditLog: {
      create: () => auditHarness.createImpl(),
    },
    authAdminLocalAccount: {
      findUnique: async ({ where }: { where: { id?: string; username?: string } }) => {
        const row = auditHarness.recovery;
        if (!row) return null;
        if (where.id && row.id !== where.id) return null;
        if (where.username && row.username !== where.username) return null;
        return { ...row };
      },
      updateMany: async ({ where }: { where: { id: string; isActive: boolean; credentialVersion: number } }) => {
        const row = auditHarness.recovery;
        return {
          count: row && row.id === where.id && row.isActive === where.isActive
            && row.credentialVersion === where.credentialVersion ? 1 : 0,
        };
      },
    },
  },
}));

/** Overridable AD outcomes for the login-flow tests. */
const ldapHarness = vi.hoisted(() => ({
  authenticateAdImpl: async (): Promise<{
    success: boolean;
    status: string;
    error?: string;
  }> => ({ success: true, status: 'authenticated' }),
  loadAdGroupMembershipImpl: async (): Promise<{ ok: true; memberOf: string[] }> => ({
    ok: true,
    memberOf: [],
  }),
  loadAdAdminStateImpl: async () => ({
    ok: true as const,
    disabled: false,
    locked: false,
    memberOf: [] as string[],
  }),
}));

vi.mock('./ldap', () => ({
  authenticateAd: (...args: unknown[]) => ldapHarness.authenticateAdImpl(args),
  loadAdGroupMembership: (...args: unknown[]) => ldapHarness.loadAdGroupMembershipImpl(args),
  loadAdAdminState: (...args: unknown[]) => ldapHarness.loadAdAdminStateImpl(args),
}));

beforeEach(() => {
  auditHarness.createImpl = async () => ({});
  auditHarness.recovery = null;
  ldapHarness.authenticateAdImpl = async () => ({ success: true, status: 'authenticated' });
  ldapHarness.loadAdGroupMembershipImpl = async () => ({ ok: true, memberOf: [] });
  ldapHarness.loadAdAdminStateImpl = async () => ({
    ok: true,
    disabled: false,
    locked: false,
    memberOf: [],
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const KEY = 'test-cookie-key-at-least-32-characters-long';

function config(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    issuer: 'http://localhost:4003',
    port: 3003,
    databaseUrl: 'postgres://x',
    redisUrl: 'redis://x',
    cookieKeys: [KEY],
    clientId: 'uar-portal',
    clientSecret: 's',
    redirectUris: [],
    postLogoutRedirects: [],
    ldapDomain: 'x',
    ldapUrl: 'ldaps://x',
    ldapSearchBase: 'x',
    ldapBindDn: '',
    ldapBindPassword: '',
    allowInvalidCertificates: false,
    turnstileSiteKey: 'site',
    turnstileSecretKey: 'secret',
    loginWindowMs: 900000,
    loginMaxAttempts: 20,
    internalBrandingToken: '',
    adminUsernames: ['admin@example.test'],
    adminGroups: [],
    adminLocalRecoveryEnabled: false,
    ...overrides,
  } as AuthConfig;
}

function fakeRedis() {
  const store = new Map<string, string>();
  const ttlKeys = new Set<string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string) {
      store.set(key, value);
      return 'OK';
    },
    async del(...keys: string[]) {
      let removed = 0;
      for (const key of keys) if (store.delete(key)) removed += 1;
      return removed;
    },
    incr: async () => 1,
    expire: async () => 1,
    // Mirrors the atomic fixed-window Lua script used by the limiters.
    eval: async (
      _script: string,
      options: { keys: string[]; arguments: string[] }
    ): Promise<number> => {
      const key = options.keys[0];
      const next = (Number.parseInt(store.get(key) ?? '0', 10) || 0) + 1;
      store.set(key, String(next));
      if (!ttlKeys.has(key)) ttlKeys.add(key);
      return next;
    },
  };
}

/** Mint a tracked session and its signed cookie exactly like the login POST. */
async function sessionCookie(
  redis: ReturnType<typeof fakeRedis>,
  username = 'admin@example.test',
  viaGroup = false
): Promise<string> {
  const sessionId = await mintAdminSessionRecord(redis);
  return signAdminSession(username, KEY, Date.now(), viaGroup, sessionId);
}

function requestWithCookie(cookie?: string): { headers: { cookie?: string }; socket: { remoteAddress: string } } {
  return {
    headers: cookie ? { cookie } : {},
    socket: { remoteAddress: '127.0.0.1' },
  };
}

describe('admin session tokens', () => {
  it('round-trips a signed, server-tracked session', async () => {
    const redis = fakeRedis();
    const cookie = await sessionCookie(redis);
    const verified = verifyAdminSession(cookie, KEY);
    expect(verified?.u).toBe('admin@example.test');
    expect(typeof verified?.j).toBe('string');
    // The tracked id matches the stored liveness record.
    expect(redis.store.get(`authsvc:adminsess:${verified?.j}`)).toBe('1');
  });

  it('rejects tampered payloads, wrong keys, and untracked cookies', async () => {
    const redis = fakeRedis();
    const token = await sessionCookie(redis);
    const [encoded] = token.split('.');
    expect(verifyAdminSession(`${encoded}.deadbeefsignature`, KEY)).toBeNull();
    expect(verifyAdminSession(token, 'another-key-at-least-32-characters!')).toBeNull();
    expect(verifyAdminSession(undefined, KEY)).toBeNull();
    expect(verifyAdminSession('garbage', KEY)).toBeNull();

    const untracked = () => signAdminSession('admin@example.test', KEY, Date.now(), false, '');
    // Minting without a tracked id fails closed instead of issuing one.
    expect(untracked).toThrow(/tracked session id/);
  });

  it('rejects expired sessions', async () => {
    const redis = fakeRedis();
    const sessionId = await mintAdminSessionRecord(redis);
    const token = signAdminSession(
      'admin@example.test',
      KEY,
      Date.now() - 9 * 60 * 60 * 1000,
      false,
      sessionId
    );
    expect(verifyAdminSession(token, KEY)).toBeNull();
  });
});

describe('adminUsernameFromRequest', () => {
  it('resolves the username when allowlisted and live', async () => {
    const redis = fakeRedis();
    const token = await sessionCookie(redis, 'ADMIN@example.test');
    const resolved = await adminUsernameFromRequest(
      requestWithCookie(`${ADMIN_COOKIE_NAME}=${token}`) as never,
      config(),
      redis
    );
    // Normalized to lowercase for allowlist comparison.
    expect(resolved).toBe('admin@example.test');
  });

  it('denies revoked sessions immediately - group-granted included', async () => {
    const redis = fakeRedis();
    const token = await sessionCookie(redis, 'group-admin@example.test', true);
    const cfg = config({ adminUsernames: [], adminGroups: ['CN=Portal Admins'] });
    ldapHarness.loadAdAdminStateImpl = async () => ({
      ok: true,
      disabled: false,
      locked: false,
      memberOf: ['CN=Portal Admins,OU=Groups,DC=example,DC=test'],
    });
    expect(
      await adminUsernameFromRequest(requestWithCookie(`${ADMIN_COOKIE_NAME}=${token}`) as never, cfg, redis)
    ).not.toBeNull();

    const verified = verifyAdminSession(token, KEY);
    await redis.del(`authsvc:adminsess:${verified?.j}`);

    // Same generic null as any invalid cookie: no revocation oracle.
    expect(
      await adminUsernameFromRequest(requestWithCookie(`${ADMIN_COOKIE_NAME}=${token}`) as never, cfg, redis)
    ).toBeNull();
  });

  it('returns null when the console is disabled or the user is not allowlisted', async () => {
    const redis = fakeRedis();
    const foreign = await sessionCookie(redis, 'random@example.test');
    const allowed = await sessionCookie(redis);
    expect(
      await adminUsernameFromRequest(requestWithCookie(`${ADMIN_COOKIE_NAME}=${foreign}`) as never, config(), redis)
    ).toBeNull();
    expect(
      await adminUsernameFromRequest(
        requestWithCookie(`${ADMIN_COOKIE_NAME}=${allowed}`) as never,
        config({ adminUsernames: [] }),
        redis
      )
    ).toBeNull();
    expect(await adminUsernameFromRequest(requestWithCookie() as never, config(), redis)).toBeNull();
  });

  it('revokes previously-issued cookies when the allowlist shrinks', async () => {
    const redis = fakeRedis();
    const token = await sessionCookie(redis, 'temp-admin@example.test');
    const cfg = config({ adminUsernames: ['admin@example.test'] });
    expect(
      await adminUsernameFromRequest(requestWithCookie(`${ADMIN_COOKIE_NAME}=${token}`) as never, cfg, redis)
    ).toBeNull();
  });

  it('fails closed when the liveness record is missing from the store', async () => {
    const mintStore = fakeRedis();
    const token = await sessionCookie(mintStore);
    const emptyStore = fakeRedis();

    expect(
      await adminUsernameFromRequest(requestWithCookie(`${ADMIN_COOKIE_NAME}=${token}`) as never, config(), emptyStore)
    ).toBeNull();
  });

  it('fails closed when AD disables the account, removes the group, or is unavailable', async () => {
    const redis = fakeRedis();
    const allowlisted = await sessionCookie(redis);
    ldapHarness.loadAdAdminStateImpl = async () => ({ ok: true, disabled: true, locked: false, memberOf: [] });
    expect(await adminUsernameFromRequest(
      requestWithCookie(`${ADMIN_COOKIE_NAME}=${allowlisted}`) as never,
      config(),
      redis
    )).toBeNull();

    const groupSession = await sessionCookie(redis, 'group-admin@example.test', true);
    ldapHarness.loadAdAdminStateImpl = async () => ({ ok: true, disabled: false, locked: false, memberOf: [] });
    expect(await adminUsernameFromRequest(
      requestWithCookie(`${ADMIN_COOKIE_NAME}=${groupSession}`) as never,
      config({ adminUsernames: [], adminGroups: ['CN=Portal Admins'] }),
      redis
    )).toBeNull();

    ldapHarness.loadAdAdminStateImpl = async () => ({ ok: false as const, reason: 'unavailable' as const });
    expect(await adminUsernameFromRequest(
      requestWithCookie(`${ADMIN_COOKIE_NAME}=${allowlisted}`) as never,
      config(),
      redis
    )).toBeNull();
  });
});

describe('Auth Manager local recovery sessions', () => {
  it('rechecks active state and credential version on every request', async () => {
    const redis = fakeRedis();
    auditHarness.recovery = {
      id: 'recovery-1',
      username: 'recovery@example.test',
      passwordHash: hashRecoveryPassword('correct horse battery staple'),
      isActive: true,
      credentialVersion: 4,
    };
    const sessionId = await mintAdminSessionRecord(redis);
    const token = signAdminSession(
      'recovery@example.test', KEY, Date.now(), false, sessionId,
      { method: 'local_recovery', accountId: 'recovery-1', credentialVersion: 4 }
    );
    const cfg = config({ adminUsernames: [], adminLocalRecoveryEnabled: true });
    const request = requestWithCookie(`${ADMIN_COOKIE_NAME}=${token}`) as never;

    expect(await adminPrincipalFromRequest(request, cfg, redis)).toMatchObject({
      username: 'recovery@example.test',
      authMethod: 'local_recovery',
      localAccountId: 'recovery-1',
      credentialVersion: 4,
    });

    auditHarness.recovery.credentialVersion = 5;
    expect(await adminPrincipalFromRequest(request, cfg, redis)).toBeNull();
    auditHarness.recovery.credentialVersion = 4;
    auditHarness.recovery.isActive = false;
    expect(await adminPrincipalFromRequest(request, cfg, redis)).toBeNull();
  });

  it('uses the local authority only for a reserved recovery username', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 })
    ));
    auditHarness.recovery = {
      id: 'recovery-1',
      username: 'recovery@example.test',
      passwordHash: hashRecoveryPassword('correct horse battery staple'),
      isActive: true,
      credentialVersion: 2,
    };
    let adTouched = false;
    ldapHarness.authenticateAdImpl = async () => {
      adTouched = true;
      return { success: false, status: 'invalid_credentials' };
    };
    const redis = fakeRedis();
    const res = {
      status: 0,
      headers: {} as Record<string, unknown>,
      writeHead(status: number, headers: Record<string, unknown>) {
        this.status = status; this.headers = headers; return this;
      },
      end() {},
    } as unknown as import('node:http').ServerResponse & { status: number; headers: Record<string, unknown> };
    const body = new URLSearchParams({
      username: 'recovery@example.test',
      password: 'correct horse battery staple',
      'cf-turnstile-response': 'token',
    }).toString();
    const req = {
      headers: {}, socket: { remoteAddress: '127.0.0.1' },
      on(event: string, callback: (value?: Buffer) => void) {
        if (event === 'data') setImmediate(() => callback(Buffer.from(body)));
        if (event === 'end') setImmediate(() => callback());
      },
    } as unknown as import('node:http').IncomingMessage;

    await handleAdminLogin(req, res, config({ adminUsernames: [], adminLocalRecoveryEnabled: true }), redis);
    expect(res.status).toBe(303);
    expect(adTouched).toBe(false);
    const cookie = String(res.headers['Set-Cookie']).split(';')[0]?.split('=').slice(1).join('=');
    expect(verifyAdminSession(cookie, KEY)).toMatchObject({
      m: 'local_recovery', a: 'recovery-1', v: 2,
    });
  });
});

describe('console surface helpers', () => {
  it('logout clears the cookie and revokes the tracked session', async () => {
    const redis = fakeRedis();
    const token = await sessionCookie(redis);
    const res = {
      headers: {} as Record<string, unknown>,
      writeHead(status: number, headers: Record<string, unknown>) {
        this.status = status;
        this.headers = headers;
        return this;
      },
      end() {},
      status: 0,
    } as unknown as import('node:http').ServerResponse & { headers: Record<string, unknown> };
    await handleAdminLogout(
      requestWithCookie(`${ADMIN_COOKIE_NAME}=${token}`) as never,
      res,
      config(),
      redis
    );
    const setCookie = String(res.headers['Set-Cookie']);
    expect(setCookie).toContain('Max-Age=0');
    expect(String(res.headers['Cache-Control'])).toBe('no-store');

    const verified = verifyAdminSession(token, KEY);
    expect(redis.store.get(`authsvc:adminsess:${verified?.j}`)).toBeUndefined();
  });

  it('login page escapes interpolated messages', () => {
    const html = renderAdminLoginPage(undefined, '<script>alert(1)</script>');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('admin login turnstile boundary', () => {
  function formRequest(body: Record<string, string>) {
    return {
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      on(event: string, cb: (chunk?: Buffer) => void) {
        if (event === 'data') setImmediate(() => cb(Buffer.from(new URLSearchParams(body).toString())));
        if (event === 'end') setImmediate(() => cb());
      },
    } as unknown as import('node:http').IncomingMessage;
  }

  function captureRes() {
    return {
      headers: {} as Record<string, unknown>,
      body: '',
      status: 0,
      writeHead(status: number, headers: Record<string, unknown>) {
        this.status = status;
        this.headers = headers;
        return this;
      },
      end(body?: string) {
        this.body = body ?? '';
      },
    } as unknown as import('node:http').ServerResponse & { headers: Record<string, unknown>; body: string; status: number };
  }

  it('renders the turnstile widget and theme bootstrap on the login page', () => {
    const html = renderAdminLoginPage('site-key');
    expect(html).toContain('cf-turnstile');
    expect(html).toContain('data-sitekey="site-key"');
    expect(html).toContain('data-size="flexible"');
    expect(html).toContain('/admin/theme.js');
    expect(html).toContain('class="identity-login"');
    expect(html).not.toContain('class="provider-mark"');
    expect(html).toContain('class="login-route"');
    expect(html).not.toMatch(/sdc/i);
  });

  it('denies BEFORE any AD contact when human verification fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 }))
    );
    try {
      const redis = fakeRedis();
      const res = captureRes();
      await handleAdminLogin(
        formRequest({ username: 'admin@example.test', password: 'whatever' }),
        res,
        config(),
        redis
      );
      expect(res.status).toBe(401);
      // Exact verification copy: the AD path would answer "Invalid credentials."
      expect(res.body).toContain('Human verification failed or was not completed.');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('never lets non-allowlisted users reach verification or AD', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      const redis = fakeRedis();
      const res = captureRes();
      await handleAdminLogin(
        formRequest({ username: 'stranger@example.test', password: 'pw' }),
        res,
        config(),
        redis
      );
      expect(res.status).toBe(401);
      expect(res.body).toContain('Invalid credentials.');
      // No siteverify consumed, no AD round-trip possible.
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('admin login per-account lockout', () => {
  function formRequest(body: Record<string, string>) {
    return {
      headers: {},
      socket: { remoteAddress: '127.0.0.1' },
      on(event: string, cb: (chunk?: Buffer) => void) {
        if (event === 'data') setImmediate(() => cb(Buffer.from(new URLSearchParams(body).toString())));
        if (event === 'end') setImmediate(() => cb());
      },
    } as unknown as import('node:http').IncomingMessage;
  }

  function captureRes() {
    return {
      headers: {} as Record<string, unknown>,
      body: '',
      status: 0,
      writeHead(status: number, headers: Record<string, unknown>) {
        this.status = status;
        this.headers = headers;
        return this;
      },
      end(body?: string) {
        this.body = body ?? '';
      },
    } as unknown as import('node:http').ServerResponse & { headers: Record<string, unknown>; body: string; status: number };
  }

  function lockConfig(): AuthConfig {
    return config({ accountLockWindowMs: 900_000, accountLockMaxAttempts: 3 });
  }

  /** Form with a Turnstile token so requests pass verification to the lockout gate. */
  function lockForm(overrides: Record<string, string> = {}): Record<string, string> {
    return { 'cf-turnstile-response': 'turnstile-token', ...overrides };
  }

  function lockKey(username: string): string {
    return `authrl:acctlock:${encodeURIComponent(username)}:${Math.floor(Date.now() / 900_000)}`;
  }

  it('denies a locked account with the generic message BEFORE any AD bind', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }))
    );
    let adTouched = false;
    ldapHarness.authenticateAdImpl = async () => {
      adTouched = true;
      throw new Error('AD must not be contacted for locked accounts');
    };
    const redis = fakeRedis();
    redis.store.set(lockKey('admin@example.test'), '3');
    const res = captureRes();

    await handleAdminLogin(
      formRequest(lockForm({ username: 'admin@example.test', password: 'whatever' })),
      res,
      lockConfig(),
      redis
    );

    // Same generic body/status as a wrong password: no state oracle.
    expect(res.status).toBe(401);
    expect(res.body).toContain('Invalid credentials.');
    expect(adTouched).toBe(false);
  });

  it('records failed AD credential attempts toward the lockout and clears on success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }))
    );
    ldapHarness.authenticateAdImpl = async () => ({
      success: false,
      status: 'invalid_credentials',
      error: 'Invalid credentials',
    });
    const redis = fakeRedis();

    await handleAdminLogin(formRequest(lockForm({ username: 'admin@example.test', password: 'bad' })), captureRes(), lockConfig(), redis);
    await handleAdminLogin(formRequest(lockForm({ username: 'ADMIN@example.test', password: 'bad' })), captureRes(), lockConfig(), redis);

    // Case-normalized into ONE per-account counter below the threshold.
    expect(Number.parseInt(redis.store.get(lockKey('admin@example.test')) ?? '0', 10)).toBe(2);

    // A successful bind clears the accumulated failures.
    ldapHarness.authenticateAdImpl = async () => ({ success: true, status: 'authenticated' });
    const successRes = captureRes();
    await handleAdminLogin(formRequest(lockForm({ username: 'admin@example.test', password: 'good' })), successRes, lockConfig(), redis);
    expect(successRes.status).toBe(303);
    expect(redis.store.get(lockKey('admin@example.test'))).toBeUndefined();
  });

  it('does NOT record policy denials toward the lockout counter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 }))
    );
    ldapHarness.authenticateAdImpl = async () => ({
      success: false,
      status: 'account_disabled',
      error: 'Account disabled',
    });
    const redis = fakeRedis();

    await handleAdminLogin(formRequest(lockForm({ username: 'admin@example.test', password: 'pw' })), captureRes(), lockConfig(), redis);

    expect(redis.store.get(lockKey('admin@example.test'))).toBeUndefined();
  });

  it('does not mint a privileged session when the success audit cannot persist', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ success: true }), { status: 200 })
    ));
    auditHarness.createImpl = async () => { throw new Error('audit unavailable'); };
    const redis = fakeRedis();

    await expect(handleAdminLogin(
      formRequest(lockForm({ username: 'admin@example.test', password: 'good' })),
      captureRes(),
      lockConfig(),
      redis
    )).rejects.toThrow('audit unavailable');

    expect([...redis.store.keys()].some((key) => key.startsWith('authsvc:adminsess:'))).toBe(false);
  });
});
