import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adminAuth: vi.fn(), hasPermission: vi.fn(), validate: vi.fn(), resolve: vi.fn(),
  parse: vi.fn(), transaction: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(),
  revision: vi.fn(), audit: vi.fn(), emitAudit: vi.fn(), query: vi.fn(), clearCache: vi.fn(),
}));
vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.adminAuth }));
vi.mock('@/lib/rbac/core', () => ({ actorHasPermission: mocks.hasPermission }));
vi.mock('@/lib/auth/sign-in-policy', () => ({
  SIGN_IN_POLICY_KEY: 'auth.signInPolicy',
  asInputJson: (value: unknown) => value,
  getPortalSignInPolicy: mocks.resolve,
  validateUsablePortalSignInPolicy: mocks.validate,
}));
vi.mock('@/lib/auth/oidc', () => ({ probeOidcProviderAvailability: vi.fn().mockResolvedValue({ available: true }) }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { UPDATE_SETTINGS: 'update_settings' }, AuditCategories: { SETTINGS: 'settings' },
  getIpAddress: vi.fn(), getUserAgent: vi.fn(), logAuditAction: mocks.audit, emitAuditActionLog: mocks.emitAudit,
}));
vi.mock('@/lib/config/resolver', () => ({ clearConfigCache: mocks.clearCache }));
vi.mock('@/lib/config/revisions', () => ({ normalizeRevisionReason: () => 'reason' }));
vi.mock('@/lib/validation', () => ({ parseJsonWithLimit: mocks.parse, isJsonBodyError: () => false, MAX_REQUEST_BODY_SIZE: { SMALL: 4096 } }));

import { GET, PUT } from './route';

const policy = {
  version: 1,
  methods: {
    oidc: { enabled: true, displayName: 'Campus Auth', description: 'Continue to Campus Auth.' },
    nativeAd: { enabled: true },
    local: { enabled: false },
  },
};

describe('/api/admin/config/sign-in', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adminAuth.mockResolvedValue({ admin: { username: 'operator' }, response: null });
    mocks.hasPermission.mockReturnValue(true);
    mocks.validate.mockResolvedValue(policy);
    mocks.resolve.mockResolvedValue({ policy, source: 'database', methods: [], revision: '2026-09-05T12:00:00.000Z' });
    mocks.parse.mockResolvedValue({ policy, reason: 'change', expectedRevision: '2026-09-05T12:00:00.000Z' });
    mocks.findUnique.mockResolvedValue({ value: policy, updatedAt: new Date('2026-09-05T12:00:00.000Z') });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      $queryRaw: mocks.query,
      systemConfigEntry: { findUnique: mocks.findUnique, upsert: mocks.upsert },
      configurationRevision: { create: mocks.revision },
    }));
  });

  it('requires settings.manage rather than directory.configure', async () => {
    mocks.hasPermission.mockReturnValue(false);
    const response = await GET(new NextRequest('https://portal.example.test/api/admin/config/sign-in'));
    expect(response.status).toBe(403);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it('validates and audits an authoritative policy write', async () => {
    const response = await PUT(new NextRequest('https://portal.example.test/api/admin/config/sign-in', { method: 'PUT' }));
    expect(response.status).toBe(200);
    expect(mocks.validate).toHaveBeenCalledTimes(2);
    expect(mocks.query).toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'auth.signInPolicy' } }));
    expect(mocks.revision).toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalled();
  });

  it('rejects a stale policy write after acquiring the policy lock', async () => {
    mocks.parse.mockResolvedValue({ policy, reason: 'stale change', expectedRevision: '2026-09-05T11:00:00.000Z' });

    const response = await PUT(new NextRequest('https://portal.example.test/api/admin/config/sign-in', { method: 'PUT' }));

    expect(response.status).toBe(409);
    expect(mocks.query).toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('requires clients to submit the revision they loaded', async () => {
    mocks.parse.mockResolvedValue({ policy, reason: 'change without revision' });

    const response = await PUT(new NextRequest('https://portal.example.test/api/admin/config/sign-in', { method: 'PUT' }));

    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('rejects a null JSON document without treating it as an internal error', async () => {
    mocks.parse.mockResolvedValue(null);

    const response = await PUT(new NextRequest('https://portal.example.test/api/admin/config/sign-in', { method: 'PUT' }));

    expect(response.status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([
    [{ admin: null, response: null }, true, 401],
    [{ admin: { username: 'operator' }, response: null }, false, 403],
  ])('denies unauthorized policy writes', async (auth, permitted, status) => {
    mocks.adminAuth.mockResolvedValue(auth);
    mocks.hasPermission.mockReturnValue(permitted);

    const response = await PUT(new NextRequest('https://portal.example.test/api/admin/config/sign-in', { method: 'PUT' }));

    expect(response.status).toBe(status);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
