import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkAdminAuthWithRateLimit: vi.fn(),
  listUsersInOU: vi.fn(),
  vpnFindMany: vi.fn(),
  requestFindMany: vi.fn(),
  batchItemFindMany: vi.fn(),
  isModuleEnabled: vi.fn(),
  cloneReadOnly: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.checkAdminAuthWithRateLimit }));
vi.mock('@/lib/ldap', () => ({ listUsersInOU: mocks.listUsersInOU }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    vPNAccount: { findMany: mocks.vpnFindMany },
    accessRequest: { findMany: mocks.requestFindMany },
    batchAccountItem: { findMany: mocks.batchItemFindMany },
  },
}));
vi.mock('@/lib/modules/core', () => ({ isModuleEnabled: mocks.isModuleEnabled }));
vi.mock('@/lib/clone-safety', () => ({ isProductionCloneReadOnly: mocks.cloneReadOnly }));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
    admin: { username: 'operator1', permissions: new Set(['lifecycle.read', 'access_requests.provision']) },
    response: null,
  });
  mocks.listUsersInOU.mockResolvedValue([{
    dn: 'CN=Person One,OU=Users,DC=example,DC=test',
    username: 'person1',
    displayName: 'Person One',
    email: 'person1@example.test',
    accountEnabled: true,
  }]);
  mocks.vpnFindMany.mockResolvedValue([{
    id: 'vpn-1',
    username: 'vpn-person-one',
    adUsername: 'person1',
    name: 'Person One',
    email: 'person1@example.test',
    status: 'active',
    portalType: 'Management',
    canRestore: true,
    accessRequestId: 'request-1',
  }]);
  mocks.requestFindMany.mockResolvedValue([{
    id: 'request-1',
    name: 'Person One',
    email: 'person1@example.test',
    status: 'approved',
    provisioningState: 'completed',
    adAccountStatus: 'disabled',
    adDisabledAt: new Date('2026-08-30T22:00:00.000Z'),
    adDisabledBy: 'operator1',
    adDisabledReason: 'Owner approved account retirement.',
    ldapUsername: 'person1',
    linkedAdUsername: 'person1',
    vpnUsername: 'vpn-person-one',
    linkedVpnUsername: 'vpn-person-one',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  }]);
  mocks.batchItemFindMany.mockResolvedValue([]);
  mocks.isModuleEnabled.mockResolvedValue(true);
  mocks.cloneReadOnly.mockReturnValue(true);
});

describe('GET /api/admin/account-lifecycle/inventory', () => {
  it('requires lifecycle.read', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'operator1', permissions: new Set() },
      response: null,
    });

    const response = await GET(new NextRequest('https://example.test/api/admin/account-lifecycle/inventory'));

    expect(response.status).toBe(403);
    expect(mocks.listUsersInOU).not.toHaveBeenCalled();
  });

  it('returns one governed identity with exact AD and VPN targets plus environment capabilities', async () => {
    const response = await GET(new NextRequest('https://example.test/api/admin/account-lifecycle/inventory'));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      readOnly: true,
      vpnModuleEnabled: true,
      summary: { total: 1, directory: 1, vpn: 1 },
      accounts: [{
        accountRef: 'ad:person1',
        directory: { username: 'person1' },
        vpn: { username: 'vpn-person-one', canRestore: true, relatedAccountCount: 1 },
        governance: {
          requestId: 'request-1',
          bindingPosture: 'verified',
          adAccountStatus: 'disabled',
          adDisabledAt: '2026-08-30T22:00:00.000Z',
          adDisabledBy: 'operator1',
          adDisabledReason: 'Owner approved account retirement.',
        },
      }],
    });
  });

  it('does not expose directory exception details', async () => {
    mocks.listUsersInOU.mockRejectedValue(new Error('bind failed for CN=secret,DC=internal'));

    const response = await GET(new NextRequest('https://example.test/api/admin/account-lifecycle/inventory'));
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data).toEqual({ error: 'Unable to build the lifecycle account inventory.' });
    expect(JSON.stringify(data)).not.toContain('CN=secret');
  });
});
