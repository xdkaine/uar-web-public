import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  moduleGuard: vi.fn(),
  permission: vi.fn(),
  importFindUnique: vi.fn(),
  transaction: vi.fn(),
  vpnFindUnique: vi.fn(),
  vpnCreate: vi.fn(),
  requestFindMany: vi.fn(),
  requestCreate: vi.fn(),
  statusCreate: vi.fn(),
  syncFindFirst: vi.fn(),
  syncCreate: vi.fn(),
  syncUpdate: vi.fn(),
  matchCreate: vi.fn(),
  matchCount: vi.fn(),
  importRecordUpdate: vi.fn(),
  importRecordCount: vi.fn(),
  importUpdate: vi.fn(),
  acquireFence: vi.fn(),
  acquireVpnFence: vi.fn(),
  batchClaims: vi.fn(),
  ldapSearch: vi.fn(),
  audit: vi.fn(),
  getIpAddress: vi.fn(),
  sendFacultyNotification: vi.fn(),
  sendDirectorNotification: vi.fn(),
  getEmailConfig: vi.fn(),
}));

const tx = {
  vPNAccount: { findUnique: mocks.vpnFindUnique, create: mocks.vpnCreate },
  accessRequest: { findMany: mocks.requestFindMany, create: mocks.requestCreate },
  vPNAccountStatusLog: { create: mocks.statusCreate },
  aDAccountSync: { findFirst: mocks.syncFindFirst, create: mocks.syncCreate, update: mocks.syncUpdate },
  aDAccountMatch: { create: mocks.matchCreate, count: mocks.matchCount },
  vPNImportRecord: { update: mocks.importRecordUpdate, count: mocks.importRecordCount },
  vPNImport: { update: mocks.importUpdate },
};

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/modules/guards', () => ({ requireModuleEnabled: mocks.moduleGuard }));
vi.mock('@/lib/rbac/core', () => ({ actorHasPermission: mocks.permission }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    vPNImport: { findUnique: mocks.importFindUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/directory-ownership-fence', () => ({
  acquireDirectoryOwnershipFence: mocks.acquireFence,
  findBatchDirectoryOwnershipClaims: mocks.batchClaims,
}));
vi.mock('@/lib/vpn-ownership-fence', () => ({ acquireVpnOwnershipFence: mocks.acquireVpnFence }));
vi.mock('@/lib/ldap', () => ({ searchLDAPUser: mocks.ldapSearch }));
vi.mock('@/lib/audit-log', () => ({
  getIpAddress: mocks.getIpAddress,
  logAuditAction: mocks.audit,
}));
vi.mock('@/lib/encryption', () => ({ encryptPassword: () => 'encrypted-password' }));
vi.mock('@/lib/password', () => ({ generateStrongPassword: () => 'temporary-password' }));
vi.mock('@/lib/logger', () => ({ appLogger: { info: vi.fn(), warn: vi.fn() } }));
vi.mock('@/lib/email', () => ({
  sendVPNPendingFacultyNotification: mocks.sendFacultyNotification,
  sendStudentDirectorNotification: mocks.sendDirectorNotification,
}));
vi.mock('@/lib/email-config', () => ({ getEmailConfig: mocks.getEmailConfig }));

import { POST } from './route';

const url = 'https://portal.example.test/api/admin/vpn-import/process';
const record = {
  id: 'record-1',
  vpnUsername: 'vpn-person',
  adUsername: 'ad-person',
  email: 'person@example.test',
  adEmail: null,
  fullName: 'VPN Person',
  adDisplayName: 'Directory Person',
};

function request() {
  return new NextRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ importId: 'import-1' }),
  });
}

function importFixture() {
  return {
    id: 'import-1',
    fileName: 'vpn-import.csv',
    importedBy: 'importer',
    userType: 'External',
    portalType: null,
    importRecords: [record],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ admin: { username: 'vpn-admin' }, response: null });
  mocks.permission.mockReturnValue(true);
  mocks.moduleGuard.mockResolvedValue(null);
  mocks.importFindUnique.mockResolvedValue(importFixture());
  mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
  mocks.acquireFence.mockResolvedValue(undefined);
  mocks.acquireVpnFence.mockResolvedValue(undefined);
  mocks.batchClaims.mockResolvedValue([]);
  mocks.ldapSearch.mockResolvedValue({ objectName: 'CN=Directory Person', attributes: [] });
  mocks.vpnFindUnique.mockResolvedValue(null);
  mocks.requestFindMany.mockResolvedValue([]);
  mocks.requestCreate.mockResolvedValue({ id: 'request-1' });
  mocks.vpnCreate.mockResolvedValue({ id: 'vpn-1' });
  mocks.statusCreate.mockResolvedValue({});
  mocks.syncFindFirst.mockResolvedValue(null);
  mocks.importRecordUpdate.mockResolvedValue({});
  mocks.importRecordCount.mockResolvedValueOnce(1).mockResolvedValueOnce(1);
  mocks.importUpdate.mockResolvedValue({});
  mocks.matchCount.mockResolvedValue(0);
  mocks.audit.mockResolvedValue(undefined);
  mocks.getIpAddress.mockReturnValue('203.0.113.20');
  mocks.getEmailConfig.mockResolvedValue({ facultyEmail: null });
  mocks.sendFacultyNotification.mockResolvedValue(undefined);
  mocks.sendDirectorNotification.mockResolvedValue(undefined);
});

describe('POST /api/admin/vpn-import/process', () => {
  it.each(['processing', 'completed', 'reconciliation_required'])(
    'requires review for a standalone %s batch owner before synthetic request or VPN writes',
    async (status) => {
      mocks.batchClaims.mockResolvedValue([{ id: 'batch-item-1', batchId: 'batch-1', accountType: 'BOTH', status }]);
      mocks.importRecordCount.mockReset().mockResolvedValueOnce(0).mockResolvedValueOnce(1);

      const response = await POST(request());
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toMatchObject({ createdCount: 0, errorCount: 1 });
      expect(body.data.errors).toEqual(['vpn-person: Review required before importing this account']);
      expect(mocks.ldapSearch).toHaveBeenCalledWith('ad-person');
      expect(mocks.batchClaims).toHaveBeenCalledWith(tx, 'ad-person', 'AD');
      expect(mocks.requestCreate).not.toHaveBeenCalled();
      expect(mocks.vpnCreate).not.toHaveBeenCalled();
      expect(mocks.statusCreate).not.toHaveBeenCalled();
      expect(mocks.importRecordUpdate).not.toHaveBeenCalled();
    }
  );

  it('checks batch ownership after confirming the current LDAP account under the ownership fence', async () => {
    mocks.batchClaims.mockResolvedValue([{ id: 'batch-item-1', batchId: 'batch-1', accountType: 'AD', status: 'completed' }]);
    mocks.importRecordCount.mockReset().mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    await POST(request());

    expect(mocks.acquireFence.mock.invocationCallOrder[0]).toBeLessThan(mocks.ldapSearch.mock.invocationCallOrder[0]);
    expect(mocks.acquireVpnFence.mock.invocationCallOrder[0]).toBeLessThan(mocks.ldapSearch.mock.invocationCallOrder[0]);
    expect(mocks.acquireFence.mock.invocationCallOrder[0]).toBeLessThan(mocks.acquireVpnFence.mock.invocationCallOrder[0]);
    expect(mocks.ldapSearch.mock.invocationCallOrder[0]).toBeLessThan(mocks.batchClaims.mock.invocationCallOrder[0]);
    expect(mocks.requestCreate).not.toHaveBeenCalled();
    expect(mocks.vpnCreate).not.toHaveBeenCalled();
  });

  it('rechecks claims that appear while waiting for the VPN ownership fence', async () => {
    let releaseVpnFence: (() => void) | undefined;
    mocks.acquireVpnFence.mockImplementation(() => new Promise<void>((resolve) => {
      releaseVpnFence = () => {
        mocks.batchClaims.mockResolvedValueOnce([
          { id: 'batch-item-1', batchId: 'batch-1', accountType: 'AD', status: 'processing' },
        ]);
        resolve();
      };
    }));
    mocks.importRecordCount.mockReset().mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const pendingResponse = POST(request());
    await vi.waitFor(() => expect(releaseVpnFence).toBeTypeOf('function'));
    releaseVpnFence!();
    const response = await pendingResponse;
    const body = await response.json();

    expect(body.data.errors).toEqual(['vpn-person: Review required before importing this account']);
    expect(mocks.acquireFence.mock.invocationCallOrder[0]).toBeLessThan(mocks.acquireVpnFence.mock.invocationCallOrder[0]);
    expect(mocks.acquireVpnFence.mock.invocationCallOrder[0]).toBeLessThan(mocks.batchClaims.mock.invocationCallOrder[0]);
    expect(mocks.requestCreate).not.toHaveBeenCalled();
    expect(mocks.vpnCreate).not.toHaveBeenCalled();
  });

  it('takes both namespaces when AD and VPN usernames are identical', async () => {
    mocks.importFindUnique.mockResolvedValue({
      ...importFixture(),
      importRecords: [{ ...record, vpnUsername: record.adUsername }],
    });

    await POST(request());

    expect(mocks.acquireFence).toHaveBeenCalledWith(tx, 'ad-person');
    expect(mocks.acquireVpnFence).toHaveBeenCalledWith(tx, 'ad-person');
  });

  it('requires review when the VPN username is owned by a standalone batch item', async () => {
    mocks.batchClaims
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 'batch-item-vpn', batchId: 'batch-1', accountType: 'VPN', status: 'completed' }]);
    mocks.importRecordCount.mockReset().mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const response = await POST(request());
    const body = await response.json();

    expect(body.data.errors).toEqual(['vpn-person: Review required before importing this account']);
    expect(mocks.batchClaims).toHaveBeenNthCalledWith(1, tx, 'ad-person', 'AD');
    expect(mocks.batchClaims).toHaveBeenNthCalledWith(2, tx, 'vpn-person', 'VPN');
    expect(mocks.requestCreate).not.toHaveBeenCalled();
    expect(mocks.vpnCreate).not.toHaveBeenCalled();
  });

  it('continues the legacy non-batch import contract when no batch ownership claim exists', async () => {
    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({ createdCount: 1, errorCount: 0, totalCreated: 1 });
    expect(mocks.requestCreate).toHaveBeenCalledTimes(1);
    expect(mocks.vpnCreate).toHaveBeenCalledTimes(1);
    expect(mocks.importRecordUpdate).toHaveBeenCalledTimes(1);
  });

  it('does not attach an email-matched request with mismatched ownership aliases', async () => {
    mocks.requestFindMany.mockResolvedValue([{
      id: 'request-other-person',
      ldapUsername: 'other-ad',
      linkedAdUsername: null,
      vpnUsername: 'other-vpn',
      linkedVpnUsername: null,
    }]);
    mocks.importRecordCount.mockReset().mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const response = await POST(request());
    const body = await response.json();

    expect(body.data.errors).toEqual(['vpn-person: Review required before importing this account']);
    expect(mocks.requestCreate).not.toHaveBeenCalled();
    expect(mocks.vpnCreate).not.toHaveBeenCalled();
  });

  it('retains one alias-coherent case-variant request as the VPN account owner', async () => {
    mocks.requestFindMany.mockResolvedValue([{
      id: 'request-existing',
      ldapUsername: 'AD-PERSON',
      linkedAdUsername: null,
      vpnUsername: null,
      linkedVpnUsername: 'VPN-PERSON',
    }]);

    await POST(request());

    expect(mocks.requestCreate).not.toHaveBeenCalled();
    expect(mocks.requestFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: { notIn: ['rejected', 'offboarded'] },
        OR: expect.arrayContaining([
          { email: { equals: 'person@example.test', mode: 'insensitive' } },
          { ldapUsername: { equals: 'ad-person', mode: 'insensitive' } },
          { linkedAdUsername: { equals: 'ad-person', mode: 'insensitive' } },
          { vpnUsername: { equals: 'vpn-person', mode: 'insensitive' } },
          { linkedVpnUsername: { equals: 'vpn-person', mode: 'insensitive' } },
        ]),
      }),
      take: 2,
    }));
    expect(mocks.vpnCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ accessRequestId: 'request-existing' }),
    }));
  });

  it('requires review rather than attaching split AD and VPN request owners', async () => {
    mocks.requestFindMany.mockResolvedValue([
      {
        id: 'request-ad-owner',
        ldapUsername: 'ad-person',
        linkedAdUsername: null,
        vpnUsername: null,
        linkedVpnUsername: null,
      },
      {
        id: 'request-vpn-owner',
        ldapUsername: null,
        linkedAdUsername: null,
        vpnUsername: null,
        linkedVpnUsername: 'vpn-person',
      },
    ]);
    mocks.importRecordCount.mockReset().mockResolvedValueOnce(0).mockResolvedValueOnce(1);

    const response = await POST(request());
    const body = await response.json();

    expect(body.data.errors).toEqual(['vpn-person: Review required before importing this account']);
    expect(mocks.requestCreate).not.toHaveBeenCalled();
    expect(mocks.vpnCreate).not.toHaveBeenCalled();
  });

  it('does not expose LDAP/provider error details in the response or audit record', async () => {
    const providerError = 'LDAP bind failed for password=do-not-leak';
    mocks.ldapSearch.mockRejectedValue(new Error(providerError));
    mocks.importRecordCount.mockReset().mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const response = await POST(request());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.errors).toEqual(['vpn-person: Unable to process this import record']);
    expect(JSON.stringify(body)).not.toContain(providerError);
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(providerError);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(providerError);
    expect(mocks.requestCreate).not.toHaveBeenCalled();
    expect(mocks.vpnCreate).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
