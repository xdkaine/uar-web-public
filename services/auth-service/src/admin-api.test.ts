import { beforeEach, describe, expect, it, vi } from 'vitest';
import type http from 'node:http';
import { handleAdminApi } from './admin-api';
import type { AuthConfig } from './config';

const dbState = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  recoveryAccountCount: 0,
  failRecoveryAccountCount: false,
}));

vi.mock('./db', () => ({
  withSessionAdvisoryLock: async (_key: string, work: () => Promise<unknown>) => work(),
  prisma: {
    auditLog: { create: async () => ({}) },
    authBrandingProfile: { findMany: async () => [] },
    oidcClient: {
      findMany: async () => dbState.rows.map((row) => ({ ...row })),
      findUnique: async ({ where }: { where: { clientId: string } }) =>
        dbState.rows.find((row) => row.clientId === where.clientId) ?? null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `row-${dbState.rows.length + 1}`, ...data };
        dbState.rows.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { clientId: string }; data: Record<string, unknown> }) => {
        const row = dbState.rows.find((entry) => entry.clientId === where.clientId);
        if (!row) throw new Error('Record not found');
        Object.assign(row, data);
        return { ...row };
      },
      delete: async ({ where }: { where: { clientId: string } }) => {
        const index = dbState.rows.findIndex((entry) => entry.clientId === where.clientId);
        if (index < 0) throw new Error('Record not found');
        return dbState.rows.splice(index, 1)[0];
      },
    },
    applicationCatalogEntry: { findUnique: async () => null },
    authAdminLocalAccount: {
      count: async () => {
        if (dbState.failRecoveryAccountCount) throw new Error('database unavailable');
        return dbState.recoveryAccountCount;
      },
    },
    $transaction: async (callback: (tx: {
      oidcClient: {
        create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
        update(args: { where: { clientId: string }; data: Record<string, unknown> }): Promise<Record<string, unknown>>;
        delete(args: { where: { clientId: string } }): Promise<Record<string, unknown>>;
      };
      auditLog: { create(args: unknown): Promise<Record<string, never>> };
      applicationCatalogEntry: { updateMany(args: unknown): Promise<{ count: number }> };
    }) => Promise<unknown>) => callback({
      oidcClient: {
        create: async ({ data }) => {
          const row = { id: `row-${dbState.rows.length + 1}`, ...data };
          dbState.rows.push(row);
          return row;
        },
        update: async ({ where, data }) => {
          const row = dbState.rows.find((entry) => entry.clientId === where.clientId);
          if (!row) throw new Error('Record not found');
          Object.assign(row, data);
          return { ...row };
        },
        delete: async ({ where }) => {
          const index = dbState.rows.findIndex((entry) => entry.clientId === where.clientId);
          if (index < 0) throw new Error('Record not found');
          return dbState.rows.splice(index, 1)[0];
        },
      },
      auditLog: { create: async () => ({}) },
      applicationCatalogEntry: { updateMany: async () => ({ count: 0 }) },
    }),
  },
}));

process.env.AUTH_CLIENT_SECRET_ENC_KEY = 'a'.repeat(64);

function config(): AuthConfig {
  return {
    issuer: 'https://auth.example.test',
    port: 3003,
    databaseUrl: 'postgres://x',
    redisUrl: 'redis://x',
    cookieKeys: ['k'],
    clientId: 'uar-portal',
    clientSecret: 's',
    redirectUris: [],
    postLogoutRedirects: [],
    ldapDomain: 'example.test',
    ldapUrl: 'ldaps://dc.example.test',
    ldapSearchBase: 'DC=example,DC=test',
    ldapBindDn: '',
    ldapBindPassword: '',
    allowInvalidCertificates: false,
    turnstileSiteKey: 'site',
    turnstileSecretKey: 'secret',
    internalBrandingToken: '',
    adminUsernames: ['admin@example.test'],
    adminGroups: [],
    trustProxyHeaders: false,
    allowInsecureTransport: false,
    deviceRiskMode: 'off',
    deviceEvidenceKey: '',
    deviceEvidencePreviousKeys: [],
    loginWindowMs: 900_000,
    loginMaxAttempts: 20,
    accountLockWindowMs: 900_000,
    accountLockMaxAttempts: 5,
  } as AuthConfig;
}

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async set(key: string, value: string, options?: { NX?: boolean }) {
      if (options?.NX && store.has(key)) return null;
      store.set(key, value);
      return 'OK';
    },
    async expire() {
      return 1;
    },
    async del(...keys: string[]) {
      let removed = 0;
      for (const key of keys) if (store.delete(key)) removed += 1;
      return removed;
    },
    async eval(script: string, options: { keys: string[]; arguments: string[] }) {
      const [lockKey, targetKey] = options.keys;
      const [token, value] = options.arguments;
      if (store.get(lockKey) !== token) return script.includes('return -1') ? -1 : 0;
      if (script.includes("redis.call('pexpire'")) return 1;
      if (targetKey && script.includes("redis.call('set'")) {
        store.set(targetKey, value);
        return 1;
      }
      if (targetKey) return store.delete(targetKey) ? 1 : 0;
      return store.delete(lockKey) ? 1 : 0;
    },
  };
}

function jsonRequest(
  method: string,
  body?: Record<string, unknown>
): http.IncomingMessage {
  return {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    on(event: string, cb: (chunk?: Buffer) => void) {
      if (event === 'data' && body !== undefined) {
        setImmediate(() => cb(Buffer.from(JSON.stringify(body))));
      }
      if (event === 'end') setImmediate(() => cb());
    },
  } as unknown as http.IncomingMessage;
}

function captureRes() {
  return {
    status: 0,
    headers: {} as Record<string, unknown>,
    body: '',
    writeHead(status: number, headers: Record<string, unknown>) {
      this.status = status;
      Object.assign(this.headers, headers);
      return this;
    },
    end(chunk?: string | Buffer) {
      if (chunk !== undefined) this.body += chunk.toString();
      return this;
    },
  };
}

async function callApi(
  method: string,
  subPath: string,
  body?: Record<string, unknown>
): Promise<ReturnType<typeof captureRes>> {
  const res = captureRes();
  await handleAdminApi(jsonRequest(method, body), res, subPath, 'admin@example.test', config(), fakeRedis());
  return res;
}

describe('console client registry guards', () => {
  beforeEach(() => {
    dbState.rows = [];
    dbState.recoveryAccountCount = 0;
    dbState.failRecoveryAccountCount = false;
  });

  it('refuses to PATCH the immutable bootstrap client', async () => {
    const res = await callApi('PATCH', 'registry/uar-portal', { enabled: false });
    expect(res.status).toBe(400);
    const parsed = JSON.parse(res.body);
    expect(parsed.error).toBe('invalid_request');
    expect(parsed.detail).toContain('bootstrap client is immutable');
    // Nothing was written.
    expect(dbState.rows).toHaveLength(0);
  });

  it('refuses to rotate the bootstrap client secret via the PATCH path', async () => {
    const res = await callApi('PATCH', 'registry/uar-portal', { rotateSecret: true });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).detail).toContain('bootstrap client is immutable');
  });

  it('refuses to DELETE the immutable bootstrap client', async () => {
    const res = await callApi('DELETE', 'registry/uar-portal');
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).detail).toContain('bootstrap client is immutable');
  });

  it('rejects unknown scopes and offline_access with a clear 400 detail', async () => {
    const offline = await callApi('POST', 'registry', {
      name: 'Offline App',
      redirectUris: ['https://app.example.test/cb'],
      scope: 'openid offline_access',
    });
    expect(offline.status).toBe(400);
    expect(JSON.parse(offline.body).detail).toContain('offline_access');

    const unknown = await callApi('POST', 'registry', {
      name: 'Greedy App',
      redirectUris: ['https://app.example.test/cb'],
      scope: 'openid sudo',
    });
    expect(unknown.status).toBe(400);
    expect(JSON.parse(unknown.body).detail).toContain('sudo');

    // The allowlist also applies on update.
    const patched = await callApi('PATCH', 'registry/some-app', { scope: 'groups sudo' });
    expect(patched.status).toBe(400);
    expect(JSON.parse(patched.body).detail).toContain('sudo');
  });

  it('rejects a supplied non-RS256 id_token_signed_response_alg', async () => {
    const res = await callApi('POST', 'registry', {
      name: 'Alg App',
      redirectUris: ['https://alg.example.test/cb'],
      id_token_signed_response_alg: 'HS256',
    });
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).detail).toContain('RS256');

    const patchRes = await callApi('PATCH', 'registry/some-app', {
      id_token_signed_response_alg: 'PS256',
    });
    expect(patchRes.status).toBe(400);
  });

  it('accepts the default scope string and stores a normalized allowlisted scope', async () => {
    const res = await callApi('POST', 'registry', {
      name: 'Good App',
      redirectUris: ['https://good.example.test/cb'],
      scope: 'openid email profile amr groups',
    });
    expect(res.status).toBe(201);
    const created = JSON.parse(res.body).client as { clientId: string; scope: string };
    expect(created.scope).toBe('openid email profile amr groups');
  });

  it('allows non-bootstrap clients to be patched and deleted normally', async () => {
    const created = await callApi('POST', 'registry', {
      name: 'Temp App',
      redirectUris: ['https://temp.example.test/cb'],
    });
    expect(created.status).toBe(201);
    const clientId = (JSON.parse(created.body).client as { clientId: string }).clientId;

    const disabled = await callApi('PATCH', `registry/${clientId}`, { enabled: false });
    expect(disabled.status).toBe(200);

    const removed = await callApi('DELETE', `registry/${clientId}`);
    expect(removed.status).toBe(204);
  });

  it('rejects invalid redirect and session-lifetime updates instead of clearing metadata', async () => {
    const created = await callApi('POST', 'registry', {
      name: 'Stable App',
      redirectUris: ['https://stable.example.test/cb'],
    });
    const clientId = (JSON.parse(created.body).client as { clientId: string }).clientId;

    const badRedirect = await callApi('PATCH', `registry/${clientId}`, {
      redirectUris: ['javascript:alert(1)'],
    });
    expect(badRedirect.status).toBe(400);

    const badTtl = await callApi('PATCH', `registry/${clientId}`, { sessionTtlSeconds: 1 });
    expect(badTtl.status).toBe(400);
    expect(dbState.rows[0]?.redirectUris).toEqual(['https://stable.example.test/cb']);
  });
});

describe('console identity configuration', () => {
  it('returns the effective provider and policy summary without service secrets', async () => {
    dbState.recoveryAccountCount = 2;
    const res = await callApi('GET', 'identity-configuration');
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.source).toMatchObject({
      name: 'Active Directory',
      role: 'primary',
      endpoint: 'ldaps://dc.example.test',
      managedBy: 'deployment',
    });
    expect(parsed.recovery.activation).toBe('explicit Auth Manager sign-in only');
    expect(parsed.recovery.oidcEligible).toBe(false);
    expect(parsed.recovery.accountCount).toBe(2);
    expect(parsed.federation.flow).toBe('Authorization code + PKCE');
    expect(res.body).not.toContain('postgres://x');
    expect(res.body).not.toContain('redis://x');
    expect(res.body).not.toContain('"clientSecret"');
    expect(res.body).not.toContain('"ldapBindPassword"');
  });

  it('reports the recovery count as unavailable when its query fails', async () => {
    dbState.failRecoveryAccountCount = true;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await callApi('GET', 'identity-configuration');
    errorSpy.mockRestore();

    expect(res.status).toBe(200);
    expect(JSON.parse(res.body).recovery.accountCount).toBeNull();
  });
});

describe('Auth Manager recovery roster authorization', () => {
  it('allows a local recovery principal to rotate only its own password', async () => {
    const principal = {
      username: 'recovery@example.test',
      authMethod: 'local_recovery' as const,
      sessionId: 'tracked-session-id',
      viaGroup: false,
      localAccountId: 'own-account',
      credentialVersion: 1,
    };
    const createRes = captureRes();
    await handleAdminApi(
      jsonRequest('POST', { username: 'another', password: 'correct horse battery staple' }),
      createRes,
      'recovery-accounts',
      principal,
      config(),
      fakeRedis()
    );
    expect(createRes.status).toBe(403);

    const otherRotateRes = captureRes();
    await handleAdminApi(
      jsonRequest('PATCH', { action: 'rotate_password', password: 'correct horse battery staple' }),
      otherRotateRes,
      'recovery-accounts/another-account',
      principal,
      config(),
      fakeRedis()
    );
    expect(otherRotateRes.status).toBe(403);

    const enableRes = captureRes();
    await handleAdminApi(
      jsonRequest('PATCH', { action: 'set_active', active: true }),
      enableRes,
      'recovery-accounts/own-account',
      principal,
      config(),
      fakeRedis()
    );
    expect(enableRes.status).toBe(403);
  });
});
