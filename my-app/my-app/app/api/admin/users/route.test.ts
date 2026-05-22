import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkAdminAuthWithRateLimit: vi.fn(),
  listUsersInOU: vi.fn(),
  findMany: vi.fn(),
  getAccountVerificationMap: vi.fn(),
  logAuditAction: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({
  checkAdminAuthWithRateLimit: mocks.checkAdminAuthWithRateLimit,
}));

vi.mock('@/lib/ldap', () => ({
  listUsersInOU: mocks.listUsersInOU,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    vPNAccount: {
      findMany: mocks.findMany,
    },
  },
}));

vi.mock('@/lib/offboard-campaign', () => ({
  getAccountVerificationMap: mocks.getAccountVerificationMap,
  normalizeOffboardIdentifier: (value: string | null | undefined) => (value || '').trim().toLowerCase(),
}));

vi.mock('@/lib/audit-log', () => ({
  AuditActions: { VIEW_USER_LIST: 'view_user_list' },
  AuditCategories: { USER: 'user' },
  getIpAddress: vi.fn(() => '127.0.0.1'),
  getUserAgent: vi.fn(() => 'vitest'),
  logAuditAction: mocks.logAuditAction,
}));

import { GET } from './route';

const ldapUser = {
  dn: 'CN=Fixture Directory User,OU=FixtureUsers,DC=example,DC=test',
  username: 'directory1',
  displayName: 'Fixture Directory User',
  email: 'directory1@example.test',
  description: 'Student',
  accountEnabled: true,
  accountExpires: null,
  whenCreated: '2026-01-01T00:00:00.000Z',
  memberOf: [],
};

const revokedExternalVpn = {
  username: 'vpn-only1',
  status: 'revoked',
  portalType: 'External',
  email: 'vpn-only1@example.test',
};

const linkedDirectoryVpn = {
  username: 'directory1',
  status: 'active',
  portalType: 'Internal',
  email: 'directory1-vpn@example.test',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
    admin: { username: 'admin1' },
    response: null,
  });
  mocks.listUsersInOU.mockResolvedValue([ldapUser]);
  mocks.findMany.mockResolvedValue([linkedDirectoryVpn, revokedExternalVpn]);
  mocks.getAccountVerificationMap.mockResolvedValue(new Map());
});

describe('GET /api/admin/users', () => {
  it('can return AD-only users without VPN-only external accounts', async () => {
    const response = await GET(new NextRequest('https://example.test/api/admin/users?includeVpnOnly=false'));
    const body = await response.json();

    expect(body.users.map((user: { username: string }) => user.username)).toEqual(['directory1']);
    expect(body.users[0].dn).toBe(ldapUser.dn);
    expect(body.users[0].vpnDetails).toEqual({ status: 'active', portalType: 'Internal' });
    expect(mocks.logAuditAction).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({
        includeVpnOnly: false,
        userCount: 1,
        adCount: 1,
        vpnCount: 2,
      }),
    }));
  });

  it('keeps VPN-only accounts in the default combined account list', async () => {
    const response = await GET(new NextRequest('https://example.test/api/admin/users'));
    const body = await response.json();

    expect(body.users.map((user: { username: string }) => user.username)).toEqual(['directory1', 'vpn-only1']);
    expect(body.users.find((user: { username: string }) => user.username === 'directory1')).toMatchObject({
      vpnDetails: { status: 'active', portalType: 'Internal' },
    });
    expect(body.users.find((user: { username: string }) => user.username === 'vpn-only1')).toMatchObject({
      dn: '',
      description: 'VPN Account',
      accountEnabled: false,
      vpnDetails: { status: 'revoked', portalType: 'External' },
    });
  });
});
