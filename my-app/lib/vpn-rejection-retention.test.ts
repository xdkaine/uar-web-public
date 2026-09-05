import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const tx = {
    $queryRaw: vi.fn(),
    vPNAccount: { findUnique: vi.fn(), update: vi.fn() },
    vPNAccountStatusLog: { findFirst: vi.fn(), create: vi.fn() },
    accessRequest: { updateMany: vi.fn() },
  };
  return {
    tx,
    vpnFindFirst: vi.fn(),
    transaction: vi.fn(),
  };
});

vi.mock('@/lib/prisma', () => ({
  prisma: {
    vPNAccount: { findFirst: mocks.vpnFindFirst },
    $transaction: mocks.transaction,
  },
}));

import { revokeLinkedVpnForRejection } from './vpn-rejection-retention';

function vpnAccount(overrides: Record<string, unknown> = {}) {
  return {
    id: 'vpn-1', username: 'vpnuser', accessRequestId: 'request-1', status: 'active',
    revokedAt: null, revokedBy: null, revokedReason: null, canRestore: true,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.vpnFindFirst.mockResolvedValue(vpnAccount());
  mocks.tx.$queryRaw.mockResolvedValue([{ lock_acquired: 'locked', locked_id: 'vpn-1' }]);
  mocks.tx.vPNAccount.findUnique.mockResolvedValue(vpnAccount());
  mocks.tx.vPNAccountStatusLog.findFirst.mockResolvedValue({ id: 'status-1', newStatus: 'active' });
  mocks.tx.accessRequest.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (callback: (tx: typeof mocks.tx) => Promise<unknown>) => callback(mocks.tx));
});

describe('revokeLinkedVpnForRejection', () => {
  it('revokes and retains the VPN record while projecting request provenance', async () => {
    const result = await revokeLinkedVpnForRejection({ requestId: 'request-1', requestVersion: 4, actor: 'admin1' });

    expect(result).toEqual({ username: 'vpnuser', status: 'active' });
    expect(mocks.tx.vPNAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'vpn-1' },
      data: expect.objectContaining({ status: 'revoked', revokedBy: 'admin1', canRestore: false }),
    }));
    expect(mocks.tx.vPNAccountStatusLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ oldStatus: 'active', newStatus: 'revoked' }),
    }));
    expect(mocks.tx.accessRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'request-1', version: 4, provisioningState: 'rejection_in_progress' }),
      data: expect.objectContaining({ vpnAccountStatus: 'revoked', vpnRevokedBy: 'admin1' }),
    }));
  });

  it('preserves complete existing revoke provenance and still projects it', async () => {
    const revokedAt = new Date('2026-08-30T20:00:00.000Z');
    const revoked = vpnAccount({
      status: 'revoked', revokedAt, revokedBy: 'admin0', revokedReason: 'Prior revocation', canRestore: false,
    });
    mocks.vpnFindFirst.mockResolvedValue(revoked);
    mocks.tx.vPNAccount.findUnique.mockResolvedValue(revoked);
    mocks.tx.vPNAccountStatusLog.findFirst.mockResolvedValue({ id: 'status-1', newStatus: 'revoked' });

    await revokeLinkedVpnForRejection({ requestId: 'request-1', requestVersion: 4, actor: 'admin1' });

    expect(mocks.tx.vPNAccount.update).not.toHaveBeenCalled();
    expect(mocks.tx.vPNAccountStatusLog.create).not.toHaveBeenCalled();
    expect(mocks.tx.accessRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        vpnAccountStatus: 'revoked', vpnRevokedAt: revokedAt, vpnRevokedBy: 'admin0', vpnRevokedReason: 'Prior revocation',
      }),
    }));
  });

  it('repairs incomplete already-revoked provenance and missing immutable status evidence', async () => {
    const revoked = vpnAccount({ status: 'revoked', revokedAt: null, revokedBy: null, revokedReason: null, canRestore: true });
    mocks.vpnFindFirst.mockResolvedValue(revoked);
    mocks.tx.vPNAccount.findUnique.mockResolvedValue(revoked);
    mocks.tx.vPNAccountStatusLog.findFirst.mockResolvedValue(null);

    await revokeLinkedVpnForRejection({ requestId: 'request-1', requestVersion: 4, actor: 'admin1' });

    expect(mocks.tx.vPNAccount.update).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'revoked', revokedBy: 'admin1', canRestore: false }),
    }));
    expect(mocks.tx.vPNAccountStatusLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        oldStatus: 'revoked',
        newStatus: 'revoked',
        reason: expect.stringContaining('repaired'),
      }),
    }));
  });

  it('fails the transaction when the request projection CAS is lost', async () => {
    mocks.tx.accessRequest.updateMany.mockResolvedValue({ count: 0 });

    await expect(revokeLinkedVpnForRejection({ requestId: 'request-1', requestVersion: 4, actor: 'admin1' }))
      .rejects.toThrow('request changed');
  });

  it('blocks linkage drift under the username and row fences', async () => {
    mocks.tx.vPNAccount.findUnique.mockResolvedValue(vpnAccount({ accessRequestId: 'request-2' }));

    await expect(revokeLinkedVpnForRejection({ requestId: 'request-1', requestVersion: 4, actor: 'admin1' }))
      .rejects.toThrow('linkage changed');
    expect(mocks.tx.accessRequest.updateMany).not.toHaveBeenCalled();
    expect(mocks.tx.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
