import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adminAuth: vi.fn(), permission: vi.fn(), parse: vi.fn(), hash: vi.fn(), policy: vi.fn(),
  outerFind: vi.fn(), transaction: vi.fn(), query: vi.fn(), currentFind: vi.fn(), count: vi.fn(),
  update: vi.fn(), sessions: vi.fn(), createTasks: vi.fn(), deleteSessions: vi.fn(), audit: vi.fn(),
}));
vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.adminAuth }));
vi.mock('@/lib/rbac/core', () => ({ actorHasPermission: mocks.permission }));
vi.mock('@/lib/auth/password-hash', () => ({ hashPassword: mocks.hash }));
vi.mock('@/lib/password', () => ({ validatePasswordStrength: () => ({ isValid: true, issues: [] }) }));
vi.mock('@/lib/auth/sign-in-policy', () => ({ SIGN_IN_POLICY_KEY: 'auth.signInPolicy', getPortalSignInPolicy: mocks.policy }));
vi.mock('@/lib/audit-log', () => ({ AuditCategories: { SETTINGS: 'settings' }, getIpAddress: vi.fn(), getUserAgent: vi.fn(), logAuditAction: mocks.audit }));
vi.mock('@/lib/validation', () => ({ parseJsonWithLimit: mocks.parse, isJsonBodyError: () => false, MAX_REQUEST_BODY_SIZE: { SMALL: 4096 } }));
vi.mock('@/lib/prisma', () => ({ prisma: { localAccount: { findUnique: mocks.outerFind }, $transaction: mocks.transaction } }));

import { PATCH } from './route';

const account = { id: 'local-1', username: 'ops@local', isActive: true };
const context = { params: Promise.resolve({ id: 'local-1' }) };

describe('portal local account session fence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.adminAuth.mockResolvedValue({ admin: { username: 'operator' }, response: null });
    mocks.permission.mockReturnValue(true);
    mocks.outerFind.mockResolvedValue(account);
    mocks.hash.mockResolvedValue('new-hash');
    mocks.policy.mockResolvedValue({ policy: { methods: { local: { enabled: true } } } });
    mocks.currentFind.mockResolvedValue(account);
    mocks.count.mockResolvedValue(2);
    mocks.sessions.mockResolvedValue([{ id: 'session-1', providerSid: 'legacy-provider-sid' }]);
    mocks.update.mockResolvedValue({ ...account, updatedAt: new Date() });
    mocks.transaction.mockImplementation(async (callback: (tx: unknown) => unknown) => callback({
      $queryRaw: mocks.query,
      localAccount: { findUnique: mocks.currentFind, count: mocks.count, update: mocks.update },
      session: { findMany: mocks.sessions, deleteMany: mocks.deleteSessions },
      providerLogoutTask: { createMany: mocks.createTasks },
    }));
  });

  it('rotates under the username lock and retains legacy provider logout evidence', async () => {
    mocks.parse.mockResolvedValue({ password: 'Strong-Portal-Password-9!' });
    const response = await PATCH(new NextRequest('https://portal.example.test/api/admin/config/local-accounts/local-1', { method: 'PATCH' }), context);
    expect(response.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledTimes(2);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ data: { passwordHash: 'new-hash' } }));
    expect(mocks.createTasks).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({ providerSid: 'legacy-provider-sid', reason: 'portal_local_password_rotated' })],
    }));
    expect(mocks.deleteSessions).toHaveBeenCalledWith({ where: { id: { in: ['session-1'] } } });
  });

  it('will not disable the last active account while portal local sign-in is enabled', async () => {
    mocks.parse.mockResolvedValue({ isActive: false });
    mocks.count.mockResolvedValue(1);
    const response = await PATCH(new NextRequest('https://portal.example.test/api/admin/config/local-accounts/local-1', { method: 'PATCH' }), context);
    expect(response.status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.deleteSessions).not.toHaveBeenCalled();
  });
});
