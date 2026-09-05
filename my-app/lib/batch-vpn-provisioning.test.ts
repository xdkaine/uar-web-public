import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  createAccount: vi.fn(),
  createStatusLog: vi.fn(),
}));

vi.mock('./prisma', () => ({ prisma: { $transaction: mocks.transaction } }));

import { createBatchVpnAccountRecord } from './batch-vpn-provisioning';

const input = {
  username: 'vpn-user',
  name: 'VPN User',
  email: 'vpn@example.test',
  portalType: 'External',
  isInternal: false,
  expiresAt: new Date('2030-01-01T00:00:00.000Z'),
  encryptedPassword: 'ciphertext',
  createdBy: 'batch-admin',
  batchId: 'batch-1',
  batchAccountItemId: 'batch-item-1',
};

describe('createBatchVpnAccountRecord', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createAccount.mockResolvedValue({ id: 'vpn-1' });
    mocks.createStatusLog.mockResolvedValue({});
    mocks.transaction.mockImplementation(async operation => operation({
      vPNAccount: { create: mocks.createAccount },
      vPNAccountStatusLog: { create: mocks.createStatusLog },
    }));
  });

  it('creates the VPN row and initial status history in one transaction', async () => {
    await expect(createBatchVpnAccountRecord(input)).resolves.toEqual({ id: 'vpn-1' });
    expect(mocks.transaction).toHaveBeenCalledOnce();
    expect(mocks.createStatusLog).toHaveBeenCalledWith({
      data: expect.objectContaining({ accountId: 'vpn-1', newStatus: 'active' }),
    });
  });

  it('propagates a status-log failure so the transaction rolls back', async () => {
    mocks.createStatusLog.mockRejectedValue(new Error('status log unavailable'));

    await expect(createBatchVpnAccountRecord(input)).rejects.toThrow('status log unavailable');
  });

  it('propagates an ambiguous create result for candidate reconciliation', async () => {
    mocks.createAccount.mockRejectedValue(new Error('connection lost after create'));

    await expect(createBatchVpnAccountRecord(input)).rejects.toThrow('connection lost after create');
    expect(mocks.createStatusLog).not.toHaveBeenCalled();
  });
});
