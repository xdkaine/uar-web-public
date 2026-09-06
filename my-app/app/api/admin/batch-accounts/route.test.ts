import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  moduleEnabled: vi.fn(),
  transaction: vi.fn(),
  batchCreate: vi.fn(),
  batchFindUnique: vi.fn(),
  batchUpdateMany: vi.fn(),
  batchUpdate: vi.fn(),
  batchAuditCreate: vi.fn(),
  batchItemFindFirst: vi.fn(),
  batchItemCreate: vi.fn(),
  batchItemUpdate: vi.fn(),
  batchItemUpdateMany: vi.fn(),
  batchItemFindMany: vi.fn(),
  batchItemRuntimeFindFirst: vi.fn(),
  accessRequestFindFirst: vi.fn(),
  accessRequestCreate: vi.fn(),
  accessRequestUpdateMany: vi.fn(),
  vpnFindUnique: vi.fn(),
  createVpnRecord: vi.fn(),
  searchLDAP: vi.fn(),
  createLDAP: vi.fn(),
  setPassword: vi.fn(),
  setExpiration: vi.fn(),
  audit: vi.fn(),
  rollback: vi.fn(),
  vpnRollback: vi.fn(),
}));

const tx = {
  $queryRaw: vi.fn(),
  batchAccountCreation: {
    updateMany: mocks.batchUpdateMany,
    update: mocks.batchUpdate,
  },
  batchAccountItem: {
    findFirst: mocks.batchItemFindFirst,
    create: mocks.batchItemCreate,
    update: mocks.batchItemUpdate,
  },
  accessRequest: {
    findFirst: mocks.accessRequestFindFirst,
    create: mocks.accessRequestCreate,
    updateMany: mocks.accessRequestUpdateMany,
  },
};

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/modules/core', () => ({ isModuleEnabled: mocks.moduleEnabled }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
    supportTicket: { findUnique: vi.fn() },
    batchAccountCreation: {
      create: mocks.batchCreate,
      findUnique: mocks.batchFindUnique,
      updateMany: mocks.batchUpdateMany,
      update: mocks.batchUpdate,
    },
    batchAuditLog: { create: mocks.batchAuditCreate },
    batchAccountItem: {
      create: mocks.batchItemCreate,
      update: mocks.batchItemUpdate,
      findMany: mocks.batchItemFindMany,
      findFirst: mocks.batchItemRuntimeFindFirst,
      updateMany: mocks.batchItemUpdateMany,
    },
    accessRequest: { updateMany: mocks.accessRequestUpdateMany },
    vPNAccount: { findUnique: mocks.vpnFindUnique },
  },
}));
vi.mock('@/lib/ldap', () => ({
  searchLDAPUserForProvisioning: mocks.searchLDAP,
  createLDAPUser: mocks.createLDAP,
  setLDAPUserPassword: mocks.setPassword,
  setLDAPUserExpiration: mocks.setExpiration,
}));
vi.mock('@/lib/encryption', () => ({ encryptPassword: () => 'encrypted-password' }));
vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.audit,
  AuditActions: { CREATE_BATCH: 'create_batch' },
  AuditCategories: { BATCH: 'batch' },
  getIpAddress: () => '203.0.113.10',
  getUserAgent: () => 'batch-test',
}));
vi.mock('@/lib/batch-account-rollback', () => ({ rollbackBatchAccounts: mocks.rollback }));
vi.mock('@/lib/batch-vpn-rollback', () => ({ rollbackBatchVpnAccounts: mocks.vpnRollback }));
vi.mock('@/lib/batch-vpn-provisioning', () => ({ createBatchVpnAccountRecord: mocks.createVpnRecord }));

import { POST } from './route';
import { batchSubmissionFingerprint } from './batch-submission';

function request(adAccount: Record<string, unknown>) {
  return new NextRequest('https://portal.example.test/api/admin/batch-accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      description: 'Workshop identities',
      idempotencyKey: 'batch-submit-key-0001',
      adAccounts: [adAccount],
      vpnAccounts: [],
    }),
  });
}

function vpnRequest() {
  return new NextRequest('https://portal.example.test/api/admin/batch-accounts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      description: 'Workshop VPN identities',
      idempotencyKey: 'batch-submit-vpn-key-0001',
      adAccounts: [validAccount],
      vpnAccounts: [{
        name: 'VPN Person',
        email: 'vpn.person@example.test',
        vpnUsername: 'vpnperson',
        password: 'VPN-Password-42!',
        accountExpiresAt: '2027-01-01T00:00:00.000Z',
      }],
    }),
  });
}

const validAccount = {
  name: 'Batch Person',
  email: 'Batch.Person@example.test',
  ldapUsername: 'batchperson',
  password: 'Batch-Password-42!',
  isInternal: true,
};

const validSubmission = {
  description: 'Workshop identities',
  idempotencyKey: 'batch-submit-key-0001',
  adAccounts: [validAccount],
  vpnAccounts: [],
};

const createdDirectoryUser = {
  objectName: 'CN=batchperson,OU=Users,DC=example,DC=test',
  attributes: [
    { type: 'sAMAccountName', values: ['batchperson'] },
    { type: 'objectGUID', values: ['guid-batchperson'] },
    { type: 'userAccountControl', values: ['514'] },
  ],
};

describe('batch account lifecycle tracking', () => {
  beforeEach(() => {
    vi.stubEnv('ENCRYPTION_SECRET', 'batch-test-encryption-secret-at-least-32-characters');
    vi.clearAllMocks();
    mocks.searchLDAP.mockReset();
    mocks.batchUpdateMany.mockReset();
    mocks.auth.mockResolvedValue({
      admin: { username: 'batch-admin', permissions: new Set(['batch.manage']) },
      response: null,
    });
    mocks.moduleEnabled.mockResolvedValue(false);
    mocks.batchCreate.mockResolvedValue({ id: 'batch-1' });
    const loadedBatch = {
      id: 'batch-1',
      accounts: [{ id: 'item-1', accessRequestId: null, password: 'encrypted-password' }],
      auditLogs: [],
      linkedTicket: null,
    };
    mocks.batchFindUnique.mockImplementation(async (args: { where: Record<string, unknown> }) => (
      Object.hasOwn(args.where, 'submissionKey') ? null : loadedBatch
    ));
    mocks.batchUpdateMany.mockResolvedValue({ count: 1 });
    mocks.batchUpdate.mockResolvedValue({
      id: 'batch-1',
      accounts: [{ id: 'item-1', accessRequestId: null, password: 'encrypted-password' }],
      auditLogs: [],
      linkedTicket: null,
    });
    mocks.batchAuditCreate.mockResolvedValue({});
    mocks.batchItemFindFirst.mockResolvedValue(null);
    mocks.accessRequestFindFirst.mockResolvedValue(null);
    mocks.accessRequestCreate.mockResolvedValue({ id: 'request-1' });
    mocks.batchItemCreate.mockResolvedValue({ id: 'item-1' });
    mocks.batchItemUpdate.mockResolvedValue({});
    mocks.batchItemUpdateMany.mockResolvedValue({ count: 1 });
    mocks.batchItemFindMany.mockResolvedValue([{ accessRequestId: null }]);
    mocks.batchItemRuntimeFindFirst.mockResolvedValue({ accessRequestId: null });
    mocks.accessRequestUpdateMany.mockResolvedValue({ count: 1 });
    mocks.vpnFindUnique.mockResolvedValue(null);
    mocks.createVpnRecord.mockResolvedValue({ id: 'vpn-1' });
    mocks.transaction.mockImplementation(async (callback: (client: typeof tx) => unknown) => callback(tx));
    mocks.searchLDAP
      .mockResolvedValueOnce(null)
      .mockResolvedValue(createdDirectoryUser);
    mocks.createLDAP.mockResolvedValue(true);
    mocks.setPassword.mockResolvedValue(true);
    mocks.audit.mockResolvedValue(undefined);
    mocks.rollback.mockResolvedValue({ successful: [], failed: [], items: [] });
    mocks.vpnRollback.mockResolvedValue({ successful: [], failed: [], items: [] });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('rejects unauthenticated submission replay before lookup', async () => {
    mocks.auth.mockResolvedValue({ admin: null, response: null });

    const response = await POST(request(validAccount));

    expect(response.status).toBe(401);
    expect(mocks.batchFindUnique).not.toHaveBeenCalled();
    expect(mocks.batchCreate).not.toHaveBeenCalled();
  });

  it('requires batch.manage before submission replay lookup', async () => {
    mocks.auth.mockResolvedValue({
      admin: { username: 'viewer', permissions: new Set<string>() },
      response: null,
    });

    const response = await POST(request(validAccount));

    expect(response.status).toBe(403);
    expect(mocks.batchFindUnique).not.toHaveBeenCalled();
    expect(mocks.batchCreate).not.toHaveBeenCalled();
  });

  it('requires a real email before creating a governed AD request', async () => {
    const response = await POST(request({ ...validAccount, email: '' }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: 'Each AD account must have a name, email, AD username, and password',
    });
    expect(mocks.batchCreate).not.toHaveBeenCalled();
  });

  it('returns the existing tracked batch when a submission is replayed', async () => {
    mocks.batchFindUnique.mockResolvedValueOnce({
      id: 'batch-existing',
      createdBy: 'batch-admin',
      status: 'processing',
      totalAccounts: 1,
      successfulAccounts: 0,
      failedAccounts: 0,
      submissionFingerprint: batchSubmissionFingerprint(validSubmission),
    });

    const response = await POST(request(validAccount));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      replayed: true,
      batch: { id: 'batch-existing', status: 'processing' },
    });
    expect(mocks.batchAuditCreate).not.toHaveBeenCalled();
    expect(mocks.createLDAP).not.toHaveBeenCalled();
    expect(mocks.moduleEnabled).not.toHaveBeenCalled();
  });

  it('rejects reusing a submission key for a changed reviewed payload', async () => {
    mocks.batchFindUnique.mockResolvedValueOnce({
      id: 'batch-existing',
      createdBy: 'batch-admin',
      status: 'processing',
      totalAccounts: 1,
      successfulAccounts: 0,
      failedAccounts: 0,
      submissionFingerprint: batchSubmissionFingerprint(validSubmission),
    });

    const response = await POST(request({ ...validAccount, ldapUsername: 'differentuser' }));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: 'Batch submission key is already in use for different work',
    });
    expect(mocks.batchCreate).not.toHaveBeenCalled();
    expect(mocks.createLDAP).not.toHaveBeenCalled();
  });

  it('rejects reusing a submission key when only the reviewed credential changed', async () => {
    mocks.batchFindUnique.mockResolvedValueOnce({
      id: 'batch-existing',
      createdBy: 'batch-admin',
      status: 'processing',
      totalAccounts: 1,
      successfulAccounts: 0,
      failedAccounts: 0,
      submissionFingerprint: batchSubmissionFingerprint(validSubmission),
    });

    const response = await POST(request({ ...validAccount, password: 'Different-Password-42!' }));

    expect(response.status).toBe(409);
    expect(mocks.batchCreate).not.toHaveBeenCalled();
    expect(mocks.createLDAP).not.toHaveBeenCalled();
  });

  it('rejects replay when only a reviewed VPN credential changed', async () => {
    const originalVpnSubmission = {
      description: 'Workshop VPN identities',
      idempotencyKey: 'batch-submit-vpn-key-0001',
      adAccounts: [validAccount],
      vpnAccounts: [{
        name: 'VPN Person',
        email: 'vpn.person@example.test',
        vpnUsername: 'vpnperson',
        password: 'VPN-Password-42!',
        accountExpiresAt: '2027-01-01T00:00:00.000Z',
      }],
    };
    mocks.batchFindUnique.mockResolvedValueOnce({
      id: 'batch-existing',
      createdBy: 'batch-admin',
      status: 'processing',
      totalAccounts: 2,
      successfulAccounts: 0,
      failedAccounts: 0,
      submissionFingerprint: batchSubmissionFingerprint(originalVpnSubmission),
    });
    const changedRequest = new NextRequest('https://portal.example.test/api/admin/batch-accounts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...originalVpnSubmission,
        vpnAccounts: [{ ...originalVpnSubmission.vpnAccounts[0], password: 'Different-VPN-Password-42!' }],
      }),
    });

    const response = await POST(changedRequest);

    expect(response.status).toBe(409);
    expect(mocks.batchCreate).not.toHaveBeenCalled();
    expect(mocks.createVpnRecord).not.toHaveBeenCalled();
  });

  it('does not expose or replay a submission owned by another operator', async () => {
    mocks.batchFindUnique.mockResolvedValueOnce({
      id: 'batch-existing',
      createdBy: 'another-admin',
      status: 'processing',
      totalAccounts: 1,
      successfulAccounts: 0,
      failedAccounts: 0,
      submissionFingerprint: batchSubmissionFingerprint(validSubmission),
    });

    const response = await POST(request(validAccount));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: 'Batch submission key is already in use for different work',
    });
    expect(mocks.createLDAP).not.toHaveBeenCalled();
  });

  it('resolves a concurrent submission-key collision without starting duplicate work', async () => {
    mocks.batchFindUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: 'batch-existing',
        createdBy: 'batch-admin',
        status: 'processing',
        totalAccounts: 1,
        successfulAccounts: 0,
        failedAccounts: 0,
        submissionFingerprint: batchSubmissionFingerprint(validSubmission),
      });
    mocks.batchCreate.mockRejectedValueOnce({ code: 'P2002' });

    const response = await POST(request(validAccount));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({ replayed: true, batch: { id: 'batch-existing' } });
    expect(mocks.batchAuditCreate).not.toHaveBeenCalled();
    expect(mocks.createLDAP).not.toHaveBeenCalled();
  });

  it('stops before directory mutation when the processing lease is lost', async () => {
    mocks.batchUpdateMany.mockResolvedValueOnce({ count: 0 });

    const response = await POST(request(validAccount));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: 'Failed to create batch' });
    expect(mocks.createLDAP).not.toHaveBeenCalled();
    expect(mocks.setPassword).not.toHaveBeenCalled();
    expect(mocks.batchItemCreate).not.toHaveBeenCalled();
  });

  it('uses the batch item as lifecycle authority without creating an access request', async () => {
    const response = await POST(request(validAccount));

    expect(response.status).toBe(200);
    expect(mocks.accessRequestCreate).not.toHaveBeenCalled();
    expect(mocks.accessRequestFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: { not: 'rejected' } }),
    }));
    expect(mocks.batchItemCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        batchId: 'batch-1',
        adAccountStatus: null,
        ldapUsername: 'batchperson',
      }),
    });
    expect(mocks.createLDAP).toHaveBeenCalledWith(
      'batchperson',
      'Batch.Person@example.test',
      'Batch Person',
      false,
      { type: 'batch', id: 'batch-1' },
      undefined
    );
    expect(mocks.batchItemUpdate).toHaveBeenCalledWith({
      where: { id: 'item-1' },
      data: {
        targetDirectoryDn: 'CN=batchperson,OU=Users,DC=example,DC=test',
        targetDirectoryObjectGuid: 'guid-batchperson',
        mutationStage: 'ldap_identity_confirmed',
      },
    });
    expect(mocks.setPassword).toHaveBeenCalledWith(
      'batchperson',
      'Batch-Password-42!',
      'CN=batchperson,OU=Users,DC=example,DC=test'
    );
    expect(mocks.accessRequestUpdateMany).not.toHaveBeenCalled();
    expect(mocks.batchItemUpdate).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'item-1' },
      data: expect.objectContaining({
        status: 'completed',
        adAccountStatus: 'disabled',
        adDisabledBy: 'batch-admin',
      }),
    }));
    const body = await response.json();
    expect(body.batch.accounts[0]).toMatchObject({ accessRequestId: null });
    expect(body.batch.accounts[0]).not.toHaveProperty('password');
  });

  it('projects advisory locks as a Prisma-supported scalar', async () => {
    const response = await POST(request(validAccount));

    expect(response.status).toBe(200);
    const advisoryQueries = tx.$queryRaw.mock.calls.map(([strings]) =>
      Array.from(strings as TemplateStringsArray)
        .join('?')
        .replace(/\s+/g, ' ')
        .trim()
    );
    expect(advisoryQueries).toEqual([
      "SELECT 'locked'::text AS lock_acquired FROM pg_advisory_xact_lock(hashtextextended(?, 873211))",
      "SELECT 'locked'::text AS lock_acquired FROM pg_advisory_xact_lock(hashtextextended(?, 873213))",
      "SELECT 'locked'::text AS lock_acquired FROM pg_advisory_xact_lock(hashtextextended(?, 873211))",
    ]);
  });

  it('fences a late LDAP completion after recovery takes the lease', async () => {
    mocks.batchUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const response = await POST(request(validAccount));

    expect(response.status).toBe(500);
    expect(mocks.createLDAP).toHaveBeenCalledOnce();
    expect(mocks.setPassword).not.toHaveBeenCalled();
    expect(mocks.batchItemUpdate).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed' }),
    }));
  });

  it('atomically fences LDAP terminal state after recovery takes the lease', async () => {
    let renewalCount = 0;
    mocks.batchUpdateMany.mockImplementation(async () => ({
      count: ++renewalCount === 7 ? 0 : 1,
    }));

    const response = await POST(request(validAccount));

    expect(response.status).toBe(500);
    expect(mocks.createLDAP).toHaveBeenCalledOnce();
    expect(mocks.setPassword).toHaveBeenCalledOnce();
    expect(mocks.batchItemUpdate).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'completed' }),
    }));
  });

  it('fences a late VPN completion after recovery takes the lease', async () => {
    mocks.moduleEnabled.mockResolvedValue(true);
    mocks.batchItemCreate
      .mockResolvedValueOnce({ id: 'ad-item-1' })
      .mockResolvedValueOnce({ id: 'vpn-item-1' });
    let renewalCount = 0;
    mocks.batchUpdateMany.mockImplementation(async () => ({
      count: ++renewalCount === 11 ? 0 : 1,
    }));

    const response = await POST(vpnRequest());

    expect(response.status).toBe(500);
    expect(mocks.createVpnRecord).toHaveBeenCalledOnce();
    expect(mocks.batchItemUpdate).not.toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'vpn-item-1' },
      data: expect.objectContaining({ status: 'completed' }),
    }));
  });

  it('does not prepare a VPN item after the processing lease is lost', async () => {
    mocks.moduleEnabled.mockResolvedValue(true);
    mocks.batchItemCreate.mockResolvedValueOnce({ id: 'ad-item-1' });
    let renewalCount = 0;
    mocks.batchUpdateMany.mockImplementation(async () => ({
      count: ++renewalCount === 8 ? 0 : 1,
    }));

    const response = await POST(vpnRequest());

    expect(response.status).toBe(500);
    expect(mocks.batchItemCreate).toHaveBeenCalledOnce();
    expect(mocks.createVpnRecord).not.toHaveBeenCalled();
  });

  it('reconciles and rolls back an LDAP add that throws after the object appears', async () => {
    mocks.searchLDAP
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(createdDirectoryUser);
    mocks.createLDAP.mockRejectedValue(new Error('connection closed after add'));
    mocks.rollback.mockResolvedValue({
      successful: ['batchperson'],
      failed: [],
      items: [{ username: 'batchperson', outcome: 'deleted', resolved: true }],
    });

    const response = await POST(request(validAccount));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(mocks.rollback).toHaveBeenCalledWith([{
      username: 'batchperson',
      accessRequestId: null,
      targetDirectoryDn: 'CN=batchperson,OU=Users,DC=example,DC=test',
      targetDirectoryObjectGuid: 'guid-batchperson',
    }], 'batch-1');
    expect(body.error).toContain('may be retried');
    expect(mocks.accessRequestUpdateMany).not.toHaveBeenCalled();
  });

  it('marks the batch reconciliation-required when post-error identity evidence is unavailable', async () => {
    mocks.searchLDAP
      .mockReset()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null);
    mocks.createLDAP.mockRejectedValue(new Error('LDAP add outcome unknown'));
    mocks.batchUpdate.mockResolvedValue({
      id: 'batch-1',
      status: 'reconciliation_required',
      accounts: [{ id: 'item-1', accessRequestId: null, password: 'encrypted-password' }],
      auditLogs: [],
      linkedTicket: null,
    });

    const response = await POST(request(validAccount));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(mocks.rollback).not.toHaveBeenCalled();
    expect(mocks.batchUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'reconciliation_required' }),
    }));
    expect(body.error).toContain('unknown directory outcome');
  });
});
