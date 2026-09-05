import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkAdminAuthWithRateLimit: vi.fn(),
  listUsersInOU: vi.fn(),
  findMany: vi.fn(),
  requestFindMany: vi.fn(),
  batchFindMany: vi.fn(),
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
    accessRequest: { findMany: mocks.requestFindMany },
    batchAccountItem: { findMany: mocks.batchFindMany },
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
    admin: { username: 'admin1', permissions: new Set(['users.read']) },
    response: null,
  });
  mocks.listUsersInOU.mockResolvedValue([ldapUser]);
  mocks.findMany.mockResolvedValue([linkedDirectoryVpn, revokedExternalVpn]);
  mocks.requestFindMany.mockResolvedValue([]);
  mocks.batchFindMany.mockResolvedValue([]);
  mocks.getAccountVerificationMap.mockResolvedValue(new Map());
});

describe('GET /api/admin/users', () => {
  it('returns the batch run reference without fabricating a request ID', async () => {
    mocks.batchFindMany.mockResolvedValue([{
      id: 'batch-item', batchId: 'batch-run', batch: { id: 'batch-run', description: 'Fixture' },
      lifecycleOwnerKind: 'batch_item', accessRequestId: null, accountType: 'AD',
      ldapUsername: 'directory1', status: 'completed', adAccountStatus: 'disabled',
    }]);
    const response = await GET(new NextRequest('https://example.test/api/admin/users'));
    const data = await response.json();
    expect(data.users.find((user: { username: string }) => user.username === 'directory1')).toMatchObject({
      ownership: { ownerType: 'batch_account', batchRunId: 'batch-run', requestId: null, batchHref: null },
    });
  });
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

  it('reports a successful empty Active Directory result distinctly from an error', async () => {
    mocks.listUsersInOU.mockResolvedValue([]);
    mocks.findMany.mockResolvedValue([]);

    const response = await GET(new NextRequest('https://example.test/api/admin/users?includeVpnOnly=false'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual(expect.objectContaining({
      users: [],
      directory: { state: 'success' },
    }));
  });

  it('reports a successful capped Active Directory result', async () => {
    mocks.listUsersInOU.mockResolvedValue(Array.from({ length: 1000 }, (_, index) => ({
      ...ldapUser,
      username: `directory${index}`,
    })));
    mocks.findMany.mockResolvedValue([]);

    const response = await GET(new NextRequest('https://example.test/api/admin/users?includeVpnOnly=false'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.directory).toEqual({ state: 'result_cap_reached', resultCap: 1000 });
    expect(body.users).toHaveLength(1000);
  });

  it('returns a safe state for an Active Directory size-limit failure', async () => {
    mocks.listUsersInOU.mockRejectedValue(Object.assign(
      new Error('LDAP size limit exceeded for CN=Sensitive Person,OU=People,DC=example,DC=test'),
      { code: '0x4' },
    ));

    const response = await GET(new NextRequest('https://example.test/api/admin/users?includeVpnOnly=false'));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.directory).toEqual(expect.objectContaining({ state: 'size_limit_error' }));
    expect(JSON.stringify(body)).not.toContain('Sensitive Person');
    expect(mocks.logAuditAction).toHaveBeenCalledWith(expect.objectContaining({
      outcome: 'failure',
      success: false,
      details: { directoryFetchState: 'size_limit_error', includeVpnOnly: false },
    }));
  });

  it('returns a query-failure state for a directory connectivity error and recovers on the next request', async () => {
    mocks.listUsersInOU.mockRejectedValueOnce(new Error('connect ETIMEDOUT 10.10.10.10:636'));

    const failedResponse = await GET(new NextRequest('https://example.test/api/admin/users?includeVpnOnly=false'));
    const failedBody = await failedResponse.json();

    expect(failedResponse.status).toBe(503);
    expect(failedBody.directory).toEqual(expect.objectContaining({ state: 'query_error' }));
    expect(JSON.stringify(failedBody)).not.toContain('10.10.10.10');

    mocks.listUsersInOU.mockResolvedValueOnce([ldapUser]);
    const recoveredResponse = await GET(new NextRequest('https://example.test/api/admin/users?includeVpnOnly=false'));
    const recoveredBody = await recoveredResponse.json();

    expect(recoveredResponse.status).toBe(200);
    expect(recoveredBody.directory).toEqual({ state: 'success' });
    expect(recoveredBody.users).toHaveLength(1);
  });

  it('does not mislabel a VPN database failure as an Active Directory failure', async () => {
    mocks.findMany.mockRejectedValue(new Error('database unavailable'));

    const response = await GET(new NextRequest('https://example.test/api/admin/users'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toBe('The user directory data could not be assembled.');
    expect(body).not.toHaveProperty('directory');
  });

  it('does not mislabel an audit-write failure as an Active Directory failure', async () => {
    mocks.logAuditAction.mockRejectedValue(new Error('audit store unavailable'));

    const response = await GET(new NextRequest('https://example.test/api/admin/users'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).not.toHaveProperty('directory');
  });

});
