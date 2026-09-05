import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findUnique: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    batchAccountCreation: { findUnique: mocks.findUnique },
  },
}));
vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.audit,
  AuditActions: { VIEW_BATCH_DETAILS: 'view_batch_details' },
  AuditCategories: { BATCH: 'batch' },
  getIpAddress: () => '203.0.113.30',
  getUserAgent: () => 'batch-detail-test',
}));

import { GET } from './route';

const request = new NextRequest('https://portal.example.test/api/admin/batch-accounts/batch-1');
const params = { params: Promise.resolve({ id: 'batch-1' }) };

function batchFixture() {
  return {
    id: 'batch-1',
    createdAt: new Date('2026-08-31T01:00:00.000Z'),
    updatedAt: new Date('2026-08-31T01:05:00.000Z'),
    createdBy: 'batch-admin',
    description: 'Workshop accounts',
    totalAccounts: 2,
    successfulAccounts: 2,
    failedAccounts: 0,
    status: 'completed',
    completedAt: new Date('2026-08-31T01:05:00.000Z'),
    submissionKey: 'internal-replay-key',
    submissionFingerprint: 'internal-fingerprint',
    processingClaimId: 'internal-lease-id',
    processingClaimedUntil: new Date('2026-08-31T01:10:00.000Z'),
    linkedTicket: null,
    accounts: [
      {
        id: 'ad-item',
        createdAt: new Date('2026-08-31T01:00:00.000Z'),
        updatedAt: new Date('2026-08-31T01:03:00.000Z'),
        batchId: 'batch-1',
        accountType: 'AD',
        name: 'AD Person',
        email: 'ad.person@example.test',
        ldapUsername: 'adperson',
        vpnUsername: null,
        password: 'encrypted-ad-password',
        accessRequestId: 'request-1',
        accountExpiresAt: null,
        isInternal: true,
        status: 'completed',
        mutationStage: 'external_mutations_complete',
        ldapCreatedAt: new Date('2026-08-31T01:02:00.000Z'),
        vpnCreatedAt: null,
        errorMessage: null,
        completedAt: new Date('2026-08-31T01:03:00.000Z'),
        targetDirectoryDn: 'CN=adperson,OU=Users,DC=example,DC=test',
        targetDirectoryObjectGuid: 'guid-adperson',
      },
      {
        id: 'vpn-item',
        createdAt: new Date('2026-08-31T01:00:00.000Z'),
        updatedAt: new Date('2026-08-31T01:04:00.000Z'),
        batchId: 'batch-1',
        accountType: 'VPN',
        name: 'VPN Person',
        email: null,
        ldapUsername: 'storage-alias-that-is-not-ldap',
        vpnUsername: 'vpnperson',
        password: 'encrypted-vpn-password',
        accessRequestId: null,
        accountExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
        isInternal: false,
        status: 'completed',
        mutationStage: 'external_mutations_complete',
        ldapCreatedAt: null,
        vpnCreatedAt: new Date('2026-08-31T01:04:00.000Z'),
        errorMessage: null,
        completedAt: new Date('2026-08-31T01:04:00.000Z'),
        targetDirectoryDn: null,
        targetDirectoryObjectGuid: null,
      },
    ],
    auditLogs: [],
  };
}

describe('batch detail response contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      admin: { username: 'batch-admin', permissions: new Set(['batch.manage']) },
      response: null,
    });
    mocks.findUnique.mockResolvedValue(batchFixture());
    mocks.audit.mockResolvedValue(undefined);
  });

  it('requires authentication before loading a batch', async () => {
    mocks.auth.mockResolvedValue({ admin: null, response: null });

    const response = await GET(request, params);

    expect(response.status).toBe(401);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('requires batch.manage before loading batch data', async () => {
    mocks.auth.mockResolvedValue({
      admin: { username: 'viewer', permissions: new Set<string>() },
      response: null,
    });

    const response = await GET(request, params);

    expect(response.status).toBe(403);
    expect(mocks.findUnique).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('returns operator concepts without persistence or lease internals', async () => {
    const response = await GET(request, params);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.batch).not.toHaveProperty('submissionKey');
    expect(body.batch).not.toHaveProperty('submissionFingerprint');
    expect(body.batch).not.toHaveProperty('processingClaimId');
    expect(body.batch).not.toHaveProperty('processingClaimedUntil');

    expect(body.batch.accounts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'ad-item',
        accountSystem: 'AD',
        accountSystemLabel: 'Active Directory',
        username: 'adperson',
        accessRequestId: 'request-1',
      }),
      expect.objectContaining({
        id: 'vpn-item',
        accountSystem: 'VPN',
        accountSystemLabel: 'VPN',
        username: 'vpnperson',
      }),
    ]));
    for (const account of body.batch.accounts) {
      expect(account).not.toHaveProperty('ldapUsername');
      expect(account).not.toHaveProperty('vpnUsername');
      expect(account).not.toHaveProperty('password');
      expect(account).not.toHaveProperty('batchId');
    }
  });
});
