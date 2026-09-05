import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adminAuth: vi.fn(),
  permission: vi.fn(),
  parse: vi.fn(),
  transaction: vi.fn(),
  query: vi.fn(),
  revision: vi.fn(),
  audit: vi.fn(),
  emitAudit: vi.fn(),
  clearConfig: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.adminAuth }));
vi.mock('@/lib/rbac/core', () => ({ actorHasPermission: mocks.permission }));
vi.mock('@/lib/validation', () => ({
  parseJsonWithLimit: mocks.parse,
  isJsonBodyError: () => false,
  MAX_REQUEST_BODY_SIZE: { SMALL: 4096 },
}));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { UPDATE_SETTINGS: 'update_settings' },
  AuditCategories: { SETTINGS: 'settings' },
  getIpAddress: () => '192.0.2.1',
  getUserAgent: () => 'test',
  logAuditAction: mocks.audit,
  emitAuditActionLog: mocks.emitAudit,
}));
vi.mock('@/lib/config/resolver', () => ({
  clearConfigCache: mocks.clearConfig,
  resolveAllConfig: vi.fn(),
  resolveSecret: vi.fn(),
}));
vi.mock('@/lib/encryption', () => ({
  encryptPassword: (value: string) => `encrypted:${value}`,
  decryptPassword: (value: string) => value.replace(/^encrypted:/, ''),
}));
vi.mock('@/lib/auth/alternate-signin', () => ({ getOidcSignInMethods: () => [] }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }));

import { PUT } from './route';

const basePolicy = {
  version: 1,
  methods: {
    oidc: { enabled: false, displayName: 'Auth service', description: '' },
    nativeAd: { enabled: true },
    local: { enabled: false },
  },
};

function request() {
  return new NextRequest('https://portal.example.test/api/admin/config/directory-email', { method: 'PUT' });
}

function transactionWith(policy: typeof basePolicy, additionalRows: Array<[string, unknown]> = []) {
  const rows = new Map<string, unknown>([
    ['auth.signInPolicy', policy],
    ['ldap.domain', 'example.test'],
    ...additionalRows,
  ]);
  return {
    $queryRaw: mocks.query,
    systemConfigEntry: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) =>
        rows.has(where.key) ? { value: rows.get(where.key) } : null),
      delete: vi.fn(async ({ where }: { where: { key: string } }) => { rows.delete(where.key); }),
      upsert: vi.fn(),
    },
    systemSettings: { findFirst: vi.fn() },
    configurationRevision: { create: mocks.revision },
  };
}

describe('directory configuration sign-in-policy fence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('LDAP_URL', 'ldaps://dc.example.test');
    vi.stubEnv('LDAP_DOMAIN', '');
    vi.stubEnv('LDAP_BIND_DN', 'CN=portal-bind,DC=example,DC=test');
    vi.stubEnv('LDAP_BIND_PASSWORD', 'configured-secret');
    vi.stubEnv('LDAP_SEARCH_BASE', 'DC=example,DC=test');
    mocks.adminAuth.mockResolvedValue({ admin: { username: 'operator' }, response: null });
    mocks.permission.mockReturnValue(true);
    mocks.parse.mockResolvedValue({ values: { 'ldap.domain': null }, reason: 'test' });
  });

  it.each([
    [{ admin: null, response: null }, true, 401],
    [{ admin: { username: 'operator' }, response: null }, false, 403],
  ])('denies unauthorized directory configuration writes', async (auth, permitted, status) => {
    mocks.adminAuth.mockResolvedValue(auth);
    mocks.permission.mockReturnValue(permitted);

    const response = await PUT(request());

    expect(response.status).toBe(status);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('rolls back an LDAP change that would break enabled direct AD sign-in', async () => {
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(transactionWith(basePolicy)));

    const response = await PUT(request());

    expect(response.status).toBe(409);
    expect(mocks.query).toHaveBeenCalledTimes(1);
    expect(mocks.clearConfig).toHaveBeenCalledTimes(1);
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('allows the same LDAP change when direct AD is disabled', async () => {
    const localPolicy = {
      ...basePolicy,
      methods: {
        ...basePolicy.methods,
        nativeAd: { enabled: false },
        local: { enabled: true },
      },
    };
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) =>
      callback(transactionWith(localPolicy)));

    const response = await PUT(request());

    expect(response.status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledTimes(1);
  });

  it('fails closed when a stored bind secret is malformed even if the environment is set', async () => {
    const tx = transactionWith(basePolicy, [
      ['ldap.bindPassword', { __secret: 'unknown-format', data: 'not-valid' }],
    ]);
    mocks.transaction.mockImplementation(async (callback: (transaction: unknown) => unknown) => callback(tx));

    const response = await PUT(request());

    expect(response.status).toBe(500);
    expect(tx.systemConfigEntry.upsert).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
