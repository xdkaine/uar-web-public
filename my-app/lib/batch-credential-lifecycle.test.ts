import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  error: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    accessRequest: {
      update: mocks.update,
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
    },
  },
}));
vi.mock('./logger', () => ({ appLogger: { error: mocks.error } }));

import { finalizeDeliveredCredential } from './batch-credential-lifecycle';

describe('finalizeDeliveredCredential', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.update.mockResolvedValue({});
    mocks.updateMany.mockResolvedValue({ count: 1 });
  });

  it('clears only the delivered ciphertext in its claimed state', async () => {
    await expect(finalizeDeliveredCredential(
      'request-1',
      'ciphertext',
      'delivery_sending'
    )).resolves.toBe('completed');
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'request-1',
        accountPassword: 'ciphertext',
        provisioningState: 'delivery_sending',
      },
      data: {
        accountPassword: null,
        provisioningState: 'completed',
        provisioningCompletedAt: expect.any(Date),
        provisioningError: null,
      },
    });
  });

  it('reconciles a commit-unknown clear to completed', async () => {
    mocks.updateMany
      .mockRejectedValueOnce(new Error('connection lost after commit'))
      .mockResolvedValueOnce({ count: 1 });
    mocks.findUnique.mockResolvedValue({ accountPassword: null, provisioningState: 'completed' });

    await expect(finalizeDeliveredCredential(
      'request-1',
      'ciphertext',
      'delivery_sending'
    )).resolves.toBe('completed');
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'request-1', accountPassword: null, provisioningState: 'completed' },
      data: expect.objectContaining({ provisioningState: 'completed' }),
    }));
  });

  it('durably marks cleanup pending when ciphertext remains', async () => {
    mocks.updateMany
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce({ count: 1 });
    mocks.findUnique.mockResolvedValue({
      accountPassword: 'ciphertext',
      provisioningState: 'delivery_sending',
    });

    await expect(finalizeDeliveredCredential(
      'request-1',
      'ciphertext',
      'delivery_sending'
    )).resolves.toBe('credential_cleanup_pending');
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: 'request-1',
        accountPassword: 'ciphertext',
        provisioningState: 'delivery_sending',
      },
      data: expect.objectContaining({ provisioningState: 'credential_cleanup_pending' }),
    }));
  });

  it('returns reconciliation_required when no durable state can be established', async () => {
    mocks.updateMany.mockRejectedValue(new Error('write failed'));
    mocks.findUnique.mockRejectedValue(new Error('read failed'));

    await expect(finalizeDeliveredCredential(
      'request-1',
      'ciphertext',
      'delivery_sending'
    )).resolves.toBe('reconciliation_required');
  });

  it('preserves a later credential and state instead of clearing them', async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    mocks.findUnique.mockResolvedValue({
      accountPassword: 'newer-ciphertext',
      provisioningState: 'delivery_retrying',
    });

    await expect(finalizeDeliveredCredential(
      'request-1',
      'delivered-ciphertext',
      'delivery_sending'
    )).resolves.toBe('reconciliation_required');
    expect(mocks.updateMany).toHaveBeenCalledTimes(1);
  });
});
