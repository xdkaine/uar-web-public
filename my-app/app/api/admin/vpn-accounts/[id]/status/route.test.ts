import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  update: vi.fn(),
  statusCreate: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    vPNAccount: { findUnique: mocks.findUnique, update: mocks.update },
    vPNAccountStatusLog: { create: mocks.statusCreate },
  },
}));
vi.mock('@/lib/modules/guards', () => ({ requireModuleEnabled: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { DISABLE_VPN_ACCOUNT: 'disable', ENABLE_VPN_ACCOUNT: 'enable', UPDATE_VPN_ACCOUNT: 'update' },
  AuditCategories: { VPN: 'vpn' },
  getIpAddress: vi.fn(),
  getUserAgent: vi.fn(),
  logAuditAction: mocks.audit,
}));

import { PATCH } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    admin: { username: 'vpn-admin', permissions: new Set(['vpn.manage']) },
    response: null,
  });
  mocks.findUnique.mockResolvedValue({ id: 'vpn-1', username: 'vpnuser', status: 'active', password: 'encrypted' });
  mocks.update.mockResolvedValue({ id: 'vpn-1', username: 'vpnuser', status: 'disabled', password: 'encrypted' });
});

describe('PATCH /api/admin/vpn-accounts/[id]/status', () => {
  it('uses the authenticated actor instead of caller-supplied attribution', async () => {
    const response = await PATCH(
      new NextRequest('https://example.test/api/admin/vpn-accounts/vpn-1/status', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'disabled', reason: 'Expired', changedBy: 'spoofed-actor' }),
      }),
      { params: Promise.resolve({ id: 'vpn-1' }) }
    );

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ disabledBy: 'vpn-admin' }),
    }));
    expect(mocks.statusCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ changedBy: 'vpn-admin', liveAccountId: 'vpn-1' }),
    }));
  });
});
