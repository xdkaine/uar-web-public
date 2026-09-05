import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  statusLogCreate: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    vPNAccount: { findUnique: mocks.findUnique, updateMany: mocks.updateMany },
    vPNAccountStatusLog: { create: mocks.statusLogCreate },
    $transaction: mocks.transaction,
  },
}));

import { rollbackBatchVpnAccounts } from './batch-vpn-rollback';

describe('rollbackBatchVpnAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUnique.mockResolvedValue({
      id: 'vpn-1',
      username: 'vpn-user',
      batchId: 'batch-1',
      status: 'active',
    });
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.statusLogCreate.mockResolvedValue({});
    mocks.transaction.mockImplementation(async operation => operation({
      vPNAccount: { updateMany: mocks.updateMany },
      vPNAccountStatusLog: { create: mocks.statusLogCreate },
    }));
  });

  it('revokes only an active VPN account owned by the exact batch', async () => {
    const result = await rollbackBatchVpnAccounts(['vpn-user'], 'batch-1', 'admin');

    expect(result.failed).toEqual([]);
    expect(result.items).toEqual([expect.objectContaining({ outcome: 'revoked', resolved: true })]);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'vpn-1', username: 'vpn-user', batchId: 'batch-1', status: 'active' },
      data: expect.objectContaining({ status: 'revoked', canRestore: false }),
    }));
  });

  it('treats an absent or already revoked owned account as resolved', async () => {
    mocks.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'vpn-1', username: 'vpn-user', batchId: 'batch-1', status: 'revoked' });

    const result = await rollbackBatchVpnAccounts(['absent', 'vpn-user'], 'batch-1', 'admin');

    expect(result.items.map(item => item.outcome)).toEqual(['already_absent', 'already_revoked']);
    expect(result.failed).toEqual([]);
  });

  it('fails closed for ownership and unexpected-state mismatches', async () => {
    mocks.findUnique
      .mockResolvedValueOnce({ id: 'vpn-1', username: 'vpn-user', batchId: 'other-batch', status: 'active' })
      .mockResolvedValueOnce({ id: 'vpn-2', username: 'vpn-pending', batchId: 'batch-1', status: 'pending_faculty' });

    const result = await rollbackBatchVpnAccounts(['vpn-user', 'vpn-pending'], 'batch-1', 'admin');

    expect(result.items.map(item => item.outcome)).toEqual(['ownership_mismatch', 'account_state_unknown']);
    expect(result.failed).toHaveLength(2);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('reports a lost revoke claim as unresolved', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    const result = await rollbackBatchVpnAccounts(['vpn-user'], 'batch-1', 'admin');

    expect(result.items).toEqual([expect.objectContaining({ outcome: 'revoke_failed', resolved: false })]);
  });
});
