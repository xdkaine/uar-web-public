import { afterEach, describe, expect, it, vi } from 'vitest';
import { backchannelLogoutUriFor } from './config';
import { PROVIDER_RECORD_TTL_CEILING_SECONDS } from './adapter';
import {
  ALLOWED_SCOPES,
  DEFAULT_CLIENT_SCOPE,
  InvalidScopeError,
  clampSessionTtlSeconds,
  createOidcClient,
  deleteOidcClient,
  DEFAULT_SESSION_TTL_SECONDS,
  MAX_SESSION_TTL_SECONDS,
  OidcClientInCatalogError,
  providerClientAdapter,
  refreshSessionTtlCache,
  resolveSessionTtlSeconds,
  rotateOidcClientSecret,
  syncAllClientsOnBoot,
  toProviderPayload,
  updateOidcClient,
  validateRequestedIdTokenAlg,
  validateRequestedScope,
  type OidcClientRow,
} from './oidc-clients';
import { encryptClientSecret } from './secret-encryption';

const dbState: {
  rows: Array<Record<string, unknown>>;
  catalogLinkedClientId: string | null;
  deleteErrorCode: string | null;
  nextTransactionError: Error | null;
  isolationLevels: string[];
  audits: Array<Record<string, unknown>>;
} = {
  rows: [],
  catalogLinkedClientId: null,
  deleteErrorCode: null,
  nextTransactionError: null,
  isolationLevels: [],
  audits: [],
};

vi.mock('./db', () => {
  const oidcClient = {
      findMany: async (args?: { where?: { enabled?: boolean } }) => dbState.rows
        .filter((row) => args?.where?.enabled === undefined || row.enabled === args.where.enabled)
        .map((row) => ({ ...row })),
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
        if (dbState.deleteErrorCode) throw Object.assign(new Error('delete failed'), { code: dbState.deleteErrorCode });
        const index = dbState.rows.findIndex((entry) => entry.clientId === where.clientId);
        if (index < 0) throw Object.assign(new Error('not found'), { code: 'P2025' });
        return dbState.rows.splice(index, 1)[0];
      },
  };
  const applicationCatalogEntry = {
      findUnique: async ({ where }: { where: { oidcClientId: string } }) =>
        dbState.catalogLinkedClientId === where.oidcClientId ? { id: 'catalog-entry' } : null,
      updateMany: async () => ({ count: 0 }),
  };
  const auditLog = {
    create: async ({ data }: { data: Record<string, unknown> }) => {
      dbState.audits.push(data);
      return data;
    },
  };
  return {
    withSessionAdvisoryLock: async (_key: string, work: () => Promise<unknown>) => work(),
    prisma: {
      oidcClient,
      applicationCatalogEntry,
      auditLog,
      $transaction: async (
        work: (tx: unknown) => Promise<unknown>,
        options?: { isolationLevel?: string }
      ) => {
        if (options?.isolationLevel) dbState.isolationLevels.push(options.isolationLevel);
        if (dbState.nextTransactionError) {
          const error = dbState.nextTransactionError;
          dbState.nextTransactionError = null;
          throw error;
        }
        return work({ oidcClient, applicationCatalogEntry, auditLog });
      },
    },
  };
});

process.env.AUTH_CLIENT_SECRET_ENC_KEY = 'a'.repeat(64);

function row(overrides: Partial<OidcClientRow> = {}): OidcClientRow {
  return {
    id: 'row-1',
    clientId: 'acme-app',
    name: 'Acme',
    secret: 's3cret',
    redirectUris: ['https://app.example.test/callback'],
    scope: 'openid email profile amr',
    enabled: true,
    sessionTtlSeconds: null,
    createdBy: 'test',
    ...overrides,
  };
}

describe('toProviderPayload', () => {
  it('registers backchannel-logout metadata so the provider emits sid', () => {
    // Client.includeSid() is backchannelLogoutUri && backchannelLogoutSessionRequired.
    // Without both, oidc-provider omits `sid` from authorization codes and ID
    // tokens and relying parties cannot implement full logout (silent SSO).
    const payload = toProviderPayload(row());
    expect(payload.backchannel_logout_uri).toBe(
      'https://app.example.test/api/auth/oidc/backchannel-logout'
    );
    expect(payload.backchannel_logout_session_required).toBe(true);
  });

  it('derives the backchannel URI from the first redirect origin', () => {
    const payload = toProviderPayload(
      row({ redirectUris: ['https://other.example.test/cb', 'https://third.test/cb'] })
    );
    expect(payload.backchannel_logout_uri).toBe(
      'https://other.example.test/api/auth/oidc/backchannel-logout'
    );
  });

  it('keeps core client metadata intact', () => {
    const payload = toProviderPayload(row());
    expect(payload.client_id).toBe('acme-app');
    expect(payload.grant_types).toEqual(['authorization_code']);
    expect(payload.response_types).toEqual(['code']);
    expect(payload.token_endpoint_auth_method).toBe('client_secret_basic');
  });
});

describe('backchannelLogoutUriFor', () => {
  it('uses the first callback origin', () => {
    expect(
      backchannelLogoutUriFor(['http://localhost:4002/api/auth/oidc/callback'])
    ).toBe('http://localhost:4002/api/auth/oidc/backchannel-logout');
  });

  it('returns empty when no redirects exist', () => {
    expect(backchannelLogoutUriFor([])).toBe('');
  });
});

describe('per-app session TTL resolution (ADR-0014)', () => {
  afterEach(() => {
    delete process.env.AUTH_SESSION_TTL_ENV_ONLY_APP;
    dbState.rows = [];
  });

  it('clamps registry values to the adapter ceiling and rejects junk', () => {
    expect(clampSessionTtlSeconds(300)).toBe(300);
    expect(clampSessionTtlSeconds(3600.9)).toBe(3600);
    expect(clampSessionTtlSeconds(PROVIDER_RECORD_TTL_CEILING_SECONDS)).toBe(
      PROVIDER_RECORD_TTL_CEILING_SECONDS
    );
    expect(MAX_SESSION_TTL_SECONDS).toBe(PROVIDER_RECORD_TTL_CEILING_SECONDS);
    expect(clampSessionTtlSeconds(299)).toBeNull();
    // Anything beyond the Redis adapter's record ceiling would be silently
    // killed early, so the registry rejects it outright (30-day sessions die
    // at 14 days in Redis otherwise).
    expect(clampSessionTtlSeconds(30 * 24 * 60 * 60)).toBeNull();
    expect(clampSessionTtlSeconds(null)).toBeNull();
    expect(clampSessionTtlSeconds(Number.NaN)).toBeNull();
    expect(clampSessionTtlSeconds('3600' as unknown as number)).toBeNull();
  });

  it('prefers the registry mirror, then env override, then the default', async () => {
    process.env.AUTH_SESSION_TTL_ENV_ONLY_APP = '1800';
    dbState.rows = [{ clientId: 'acme-app', sessionTtlSeconds: 900 }];

    await refreshSessionTtlCache();

    expect(resolveSessionTtlSeconds('acme-app')).toBe(900);
    // Unregistered clients fall back to their env override, then the default.
    expect(resolveSessionTtlSeconds('env-only-app')).toBe(1800);
    expect(resolveSessionTtlSeconds('no-override-app')).toBe(DEFAULT_SESSION_TTL_SECONDS);
    expect(resolveSessionTtlSeconds(undefined)).toBe(DEFAULT_SESSION_TTL_SECONDS);

    delete process.env.AUTH_SESSION_TTL_ACME_APP;
    // Registry value wins over an env override for the same client.
    process.env.AUTH_SESSION_TTL_ACME_APP = '7200';
    expect(resolveSessionTtlSeconds('acme-app')).toBe(900);
  });

  it('ignores out-of-bounds registry rows and stale cache entries after refresh', async () => {
    dbState.rows = [
      { clientId: 'bad-row', sessionTtlSeconds: 1 },
      { clientId: 'good-row', sessionTtlSeconds: 600 },
    ];
    await refreshSessionTtlCache();
    expect(resolveSessionTtlSeconds('bad-row')).toBe(DEFAULT_SESSION_TTL_SECONDS);
    expect(resolveSessionTtlSeconds('good-row')).toBe(600);

    dbState.rows = [];
    await refreshSessionTtlCache();
    expect(resolveSessionTtlSeconds('good-row')).toBe(DEFAULT_SESSION_TTL_SECONDS);
  });
});

describe('registration scope allowlist', () => {
  it('exposes exactly the identity-contract scopes as allowed', () => {
    expect(ALLOWED_SCOPES).toEqual(['openid', 'email', 'profile', 'amr', 'groups']);
  });

  it('accepts the default and any subset of allowed scopes, normalized', () => {
    expect(validateRequestedScope(undefined)).toEqual({ ok: true, scope: DEFAULT_CLIENT_SCOPE });
    expect(validateRequestedScope('')).toEqual({ ok: true, scope: DEFAULT_CLIENT_SCOPE });
    expect(validateRequestedScope('openid email profile amr groups')).toEqual({
      ok: true,
      scope: 'openid email profile amr groups',
    });
    expect(validateRequestedScope('  openid   groups  ')).toEqual({ ok: true, scope: 'openid groups' });
  });

  it('explicitly rejects offline_access with a dedicated reason', () => {
    const parsed = validateRequestedScope('openid offline_access');
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.reason).toContain('offline_access');
  });

  it('rejects unknown scopes and non-string junk', () => {
    expect(validateRequestedScope('openid sudo').ok).toBe(false);
    expect(validateRequestedScope(42).ok).toBe(false);
    expect(validateRequestedScope(null).ok).toBe(false);
  });

  it('rejects non-RS256 id-token algorithms and accepts absent values', () => {
    expect(validateRequestedIdTokenAlg(undefined)).toBe(true);
    expect(validateRequestedIdTokenAlg(null)).toBe(true);
    expect(validateRequestedIdTokenAlg('RS256')).toBe(true);
    expect(validateRequestedIdTokenAlg('HS256')).toBe(false);
    expect(validateRequestedIdTokenAlg('PS256')).toBe(false);
  });

  it('pins RS256 into every provider mirror payload', () => {
    const payload = toProviderPayload(row());
    expect(payload.id_token_signed_response_alg).toBe('RS256');
  });

  it('enforces the allowlist on create AND update (throws InvalidScopeError)', async () => {
    const mirror = providerClientAdapter({
      async upsert() {},
      async destroy() {},
    });

    await expect(
      createOidcClient(
        { name: 'Bad Scope App', redirectUris: ['https://x.example.test/cb'], scope: 'openid sudo', createdBy: 't' },
        mirror
      )
    ).rejects.toBeInstanceOf(InvalidScopeError);

    await expect(
      createOidcClient(
        {
          name: 'Offline App',
          redirectUris: ['https://x.example.test/cb'],
          scope: 'openid offline_access',
          createdBy: 't',
        },
        mirror
      )
    ).rejects.toThrow(/offline_access/);

    dbState.rows.push({
      id: 'row-x',
      clientId: 'scope-app',
      name: 'Scope App',
      secret: 'plain-secret',
      redirectUris: ['https://scope.example.test/cb'],
      scope: DEFAULT_CLIENT_SCOPE,
      enabled: true,
      sessionTtlSeconds: null,
      createdBy: 't',
    });

    await expect(
      updateOidcClient('scope-app', { scope: 'sudo' }, mirror)
    ).rejects.toBeInstanceOf(InvalidScopeError);

    // A valid update still normalizes through.
    const updated = await updateOidcClient('scope-app', { scope: ' openid groups ' }, mirror);
    expect(updated?.scope).toBe('openid groups');
  });
});

describe('provider client mirror fail-closed reconciliation', () => {
  afterEach(() => {
    dbState.rows = [];
    dbState.catalogLinkedClientId = null;
    dbState.deleteErrorCode = null;
    dbState.nextTransactionError = null;
    dbState.isolationLevels = [];
    dbState.audits = [];
  });

  it('commits and returns a one-time secret with a pending mirror when Redis is unavailable', async () => {
    dbState.rows = [];
    dbState.isolationLevels = [];
    dbState.audits = [];
    const mirror = providerClientAdapter({
      async upsert() { throw new Error('redis unavailable'); },
      async destroy() {},
    });

    const created = await createOidcClient({
      name: 'Unavailable App',
      redirectUris: ['https://unavailable.example.test/cb'],
      createdBy: 'admin',
    }, mirror, { action: 'AUTH_CLIENT_CREATED', actor: 'admin' });

    expect(dbState.rows).toHaveLength(1);
    expect(dbState.rows[0].enabled).toBe(true);
    expect(created.clientSecret.length).toBeGreaterThanOrEqual(40);
    expect(created.mirrorPending).toBe(true);
    expect(dbState.audits).toHaveLength(1);
    expect(dbState.audits[0].details).toContain('"providerMirror":"pending"');
    expect(dbState.isolationLevels).toEqual(['Serializable']);
  });

  it('purges stale Redis client records on boot while preserving bootstrap metadata', async () => {
    dbState.rows = [{
      id: 'row-live', clientId: 'live-app', name: 'Live', secret: 'plain-secret',
      redirectUris: ['https://live.example.test/cb'], postLogoutRedirectUris: [],
      backchannelLogoutUri: null, scope: DEFAULT_CLIENT_SCOPE, enabled: true,
      sessionTtlSeconds: null, createdBy: 'admin',
    }];
    const mirrored: string[] = [];
    const deleted: string[] = [];
    const mirror = providerClientAdapter({
      async upsert(_id, payload) { mirrored.push((payload as { client_id: string }).client_id); },
      async destroy(id) { deleted.push(`oidc:Client:${id}`); },
    });
    const redis = {
      async *scanIterator() {
        yield ['oidc:Client:stale-app', 'oidc:Client:uar-portal'];
      },
      async del(...keys: string[]) { deleted.push(...keys); return keys.length; },
    };

    await expect(syncAllClientsOnBoot(mirror, redis, ['uar-portal'])).resolves.toBe(1);
    expect(deleted).toEqual(['oidc:Client:stale-app']);
    expect(mirrored).toEqual(['live-app']);
  });

  it('keeps durable, audited updates retriable when Redis reconciliation fails', async () => {
    const oldSecret = encryptClientSecret('old-secret');
    dbState.rows = [{
      id: 'row-safe', clientId: 'safe-app', name: 'Safe', secret: oldSecret,
      redirectUris: ['https://safe.example.test/cb'], postLogoutRedirectUris: [],
      backchannelLogoutUri: null, scope: DEFAULT_CLIENT_SCOPE, enabled: true,
      sessionTtlSeconds: null, createdBy: 'admin',
    }];
    const mirror = providerClientAdapter({
      async upsert() { throw new Error('redis unavailable'); },
      async destroy() {},
    });

    const updated = await updateOidcClient(
      'safe-app',
      { scope: 'openid groups' },
      mirror,
      { action: 'AUTH_CLIENT_UPDATED', actor: 'admin' }
    );
    expect(updated?.mirrorPending).toBe(true);
    expect(dbState.rows[0].scope).toBe('openid groups');

    const rotated = await rotateOidcClientSecret(
      'safe-app',
      mirror,
      { action: 'AUTH_CLIENT_SECRET_ROTATED', actor: 'admin' }
    );
    expect(rotated?.mirrorPending).toBe(true);
    expect(rotated?.clientSecret.length).toBeGreaterThanOrEqual(40);
    expect(dbState.rows[0].secret).not.toBe(oldSecret);
    expect(dbState.audits).toHaveLength(2);
    expect(dbState.audits.every((entry) => String(entry.details).includes('"providerMirror":"pending"')))
      .toBe(true);
  });

  it('never publishes a candidate when the durable transaction fails', async () => {
    dbState.rows = [{
      id: 'row-safe', clientId: 'safe-app', name: 'Safe', secret: encryptClientSecret('old-secret'),
      redirectUris: ['https://safe.example.test/cb'], postLogoutRedirectUris: [],
      backchannelLogoutUri: null, scope: DEFAULT_CLIENT_SCOPE, enabled: true,
      sessionTtlSeconds: null, createdBy: 'admin',
    }];
    const events: string[] = [];
    const mirror = providerClientAdapter({
      async upsert(id) { events.push(`sync:${id}`); },
      async destroy(id) { events.push(`remove:${id}`); },
    });
    dbState.nextTransactionError = new Error('audit transaction failed');

    await expect(updateOidcClient(
      'safe-app',
      { redirectUris: ['https://candidate.example.test/cb'] },
      mirror,
      { action: 'AUTH_CLIENT_UPDATED', actor: 'admin' }
    )).rejects.toThrow('audit transaction failed');
    expect(events).toEqual(['remove:safe-app']);
    expect(dbState.rows[0].redirectUris).toEqual(['https://safe.example.test/cb']);
  });

  it('keeps a catalog-linked client active on precheck and restores it after an FK race', async () => {
    dbState.rows = [{
      id: 'row-linked', clientId: 'linked-app', name: 'Linked', secret: encryptClientSecret('secret'),
      redirectUris: ['https://linked.example.test/cb'], postLogoutRedirectUris: [],
      backchannelLogoutUri: null, scope: DEFAULT_CLIENT_SCOPE, enabled: true,
      sessionTtlSeconds: null, createdBy: 'admin',
    }];
    const events: string[] = [];
    const mirror = providerClientAdapter({
      async upsert(id) { events.push(`sync:${id}`); },
      async destroy(id) { events.push(`remove:${id}`); },
    });
    dbState.catalogLinkedClientId = 'linked-app';
    await expect(deleteOidcClient('linked-app', mirror)).rejects.toBeInstanceOf(OidcClientInCatalogError);
    expect(events).toEqual([]);

    dbState.catalogLinkedClientId = null;
    dbState.deleteErrorCode = 'P2003';
    await expect(deleteOidcClient('linked-app', mirror)).rejects.toBeInstanceOf(OidcClientInCatalogError);
    expect(events).toEqual(['remove:linked-app', 'sync:linked-app']);

    events.length = 0;
    dbState.deleteErrorCode = 'P2025';
    await expect(deleteOidcClient('linked-app', mirror)).resolves.toBe(false);
    expect(events).toEqual(['remove:linked-app']);
  });

  it('serializes update against delete so a deleted client is not re-mirrored', async () => {
    dbState.rows = [{
      id: 'row-race', clientId: 'race-app', name: 'Race', secret: encryptClientSecret('secret'),
      redirectUris: ['https://race.example.test/cb'], postLogoutRedirectUris: [],
      backchannelLogoutUri: null, scope: DEFAULT_CLIENT_SCOPE, enabled: true,
      sessionTtlSeconds: null, createdBy: 'admin',
    }];
    const events: string[] = [];
    let releaseSync!: () => void;
    const syncGate = new Promise<void>((resolve) => { releaseSync = resolve; });
    let signalSync!: () => void;
    const syncStarted = new Promise<void>((resolve) => { signalSync = resolve; });
    let blockFirstSync = true;
    const mirror = providerClientAdapter({
      async upsert(id) {
        events.push(`sync:${id}`);
        if (blockFirstSync) {
          blockFirstSync = false;
          signalSync();
          await syncGate;
        }
      },
      async destroy(id) { events.push(`remove:${id}`); },
    });

    const update = updateOidcClient(
      'race-app',
      { scope: 'openid groups' },
      mirror,
      { action: 'AUTH_CLIENT_UPDATED', actor: 'admin' }
    );
    await syncStarted;
    const deletion = deleteOidcClient(
      'race-app',
      mirror,
      { action: 'AUTH_CLIENT_DELETED', actor: 'admin' }
    );
    await Promise.resolve();
    expect(events).toEqual(['remove:race-app', 'sync:race-app']);

    releaseSync();
    await expect(update).resolves.toMatchObject({ scope: 'openid groups' });
    await expect(deletion).resolves.toBe(true);
    expect(events).toEqual(['remove:race-app', 'sync:race-app', 'remove:race-app']);
    expect(dbState.rows).toHaveLength(0);
  });

  it('serializes secret rotation against delete so a deleted client is not re-mirrored', async () => {
    dbState.rows = [{
      id: 'row-rotate-race', clientId: 'rotate-race-app', name: 'Rotate race',
      secret: encryptClientSecret('secret'),
      redirectUris: ['https://rotate-race.example.test/cb'], postLogoutRedirectUris: [],
      backchannelLogoutUri: null, scope: DEFAULT_CLIENT_SCOPE, enabled: true,
      sessionTtlSeconds: null, createdBy: 'admin',
    }];
    const events: string[] = [];
    let releaseSync!: () => void;
    const syncGate = new Promise<void>((resolve) => { releaseSync = resolve; });
    let signalSync!: () => void;
    const syncStarted = new Promise<void>((resolve) => { signalSync = resolve; });
    let blockFirstSync = true;
    const mirror = providerClientAdapter({
      async upsert(id) {
        events.push(`sync:${id}`);
        if (blockFirstSync) {
          blockFirstSync = false;
          signalSync();
          await syncGate;
        }
      },
      async destroy(id) { events.push(`remove:${id}`); },
    });

    const rotation = rotateOidcClientSecret(
      'rotate-race-app',
      mirror,
      { action: 'AUTH_CLIENT_SECRET_ROTATED', actor: 'admin' }
    );
    await syncStarted;
    const deletion = deleteOidcClient(
      'rotate-race-app',
      mirror,
      { action: 'AUTH_CLIENT_DELETED', actor: 'admin' }
    );
    await Promise.resolve();
    expect(events).toEqual(['remove:rotate-race-app', 'sync:rotate-race-app']);

    releaseSync();
    await expect(rotation).resolves.toMatchObject({ mirrorPending: false });
    await expect(deletion).resolves.toBe(true);
    expect(events).toEqual([
      'remove:rotate-race-app',
      'sync:rotate-race-app',
      'remove:rotate-race-app',
    ]);
    expect(dbState.rows).toHaveLength(0);
  });

  it('serializes boot reconciliation against delete and leaves no stale mirror', async () => {
    dbState.rows = [{
      id: 'row-boot-race', clientId: 'boot-race-app', name: 'Boot race',
      secret: encryptClientSecret('secret'),
      redirectUris: ['https://boot-race.example.test/cb'], postLogoutRedirectUris: [],
      backchannelLogoutUri: null, scope: DEFAULT_CLIENT_SCOPE, enabled: true,
      sessionTtlSeconds: null, createdBy: 'admin',
    }];
    const events: string[] = [];
    let releaseSync!: () => void;
    const syncGate = new Promise<void>((resolve) => { releaseSync = resolve; });
    let signalSync!: () => void;
    const syncStarted = new Promise<void>((resolve) => { signalSync = resolve; });
    const mirror = providerClientAdapter({
      async upsert(id) {
        events.push(`sync:${id}`);
        signalSync();
        await syncGate;
      },
      async destroy(id) { events.push(`remove:${id}`); },
    });

    const bootSync = syncAllClientsOnBoot(mirror);
    await syncStarted;
    const deletion = deleteOidcClient(
      'boot-race-app',
      mirror,
      { action: 'AUTH_CLIENT_DELETED', actor: 'admin' }
    );
    await Promise.resolve();
    expect(events).toEqual(['sync:boot-race-app']);

    releaseSync();
    await expect(bootSync).resolves.toBe(1);
    await expect(deletion).resolves.toBe(true);
    expect(events).toEqual(['sync:boot-race-app', 'remove:boot-race-app']);
    expect(dbState.rows).toHaveLength(0);
  });
});
