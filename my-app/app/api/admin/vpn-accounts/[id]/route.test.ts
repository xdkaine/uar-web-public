import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  vpnUpdate: vi.fn(),
  statusCreate: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    vPNAccount: { update: mocks.vpnUpdate },
    vPNAccountStatusLog: { create: mocks.statusCreate },
  },
}));
vi.mock('@/lib/modules/guards', () => ({ requireModuleEnabled: vi.fn() }));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: {},
  AuditCategories: {},
  getIpAddress: vi.fn(),
  getUserAgent: vi.fn(),
  logAuditAction: vi.fn(),
}));

import { DELETE } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    admin: { username: 'vpn-admin', permissions: new Set(['vpn.manage']) },
    response: null,
  });
});

describe('DELETE /api/admin/vpn-accounts/[id]', () => {
  it('retires direct status-changing deletion in favor of Account Lifecycle', async () => {
    const response = await DELETE(
      new NextRequest('https://example.test/api/admin/vpn-accounts/vpn-1', { method: 'DELETE' }),
      { params: Promise.resolve({ id: 'vpn-1' }) }
    );

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, PATCH');
    await expect(response.json()).resolves.toMatchObject({ code: 'USE_ACCOUNT_LIFECYCLE' });
    expect(mocks.vpnUpdate).not.toHaveBeenCalled();
    expect(mocks.statusCreate).not.toHaveBeenCalled();
  });
});
