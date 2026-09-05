import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  findMany: vi.fn(),
  backchannel: vi.fn(),
  revokeAll: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    providerLogoutTask: {
      findUnique: mocks.findUnique,
      updateMany: mocks.updateMany,
      findMany: mocks.findMany,
    },
  },
}));
vi.mock('@/lib/auth/backchannel', () => ({
  requestProviderBackchannelLogoutDetailed: mocks.backchannel,
}));
vi.mock('@/lib/session', () => ({ revokeAllSessionsForUser: mocks.revokeAll }));
vi.mock('@/lib/audit-log', () => ({ logAuditAction: mocks.audit }));
vi.mock('@/lib/logger', () => ({ appLogger: { error: vi.fn() } }));

import { processProviderLogoutTask, revokeUserSessionsEverywhere } from './provider-logout-audit';

const task = {
  id: 'task-1',
  status: 'pending',
  claimId: null,
  claimedUntil: null,
  providerSid: 'provider-session-1',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue(task);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.backchannel.mockResolvedValue({ outcome: 'success', providerLogoutAttempted: true });
  mocks.audit.mockResolvedValue(undefined);
});

describe('provider logout tasks', () => {
  it('claims and completes a confirmed provider logout', async () => {
    const result = await processProviderLogoutTask(task.id);
    expect(result).toEqual({ attempted: true, destroyed: true, incomplete: false, reconciliationRequired: false });
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: 'processing' }),
      data: expect.objectContaining({ status: 'completed' }),
    }));
  });

  it('preserves an ambiguous provider failure for evidence-gated recovery', async () => {
    mocks.backchannel.mockResolvedValue({ outcome: 'failure', providerLogoutAttempted: true });
    const result = await processProviderLogoutTask(task.id);
    expect(result.reconciliationRequired).toBe(true);
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: 'reconciliation_required' }),
    }));
  });

  it('creates durable tasks before processing bulk revocation results', async () => {
    mocks.revokeAll.mockResolvedValue([{ id: 'session-1', username: 'user1', providerSid: 'provider-session-1' }]);
    mocks.findMany.mockResolvedValue([{ id: task.id }]);
    const result = await revokeUserSessionsEverywhere('user1', {
      actor: 'system:lifecycle',
      actorType: 'system',
      reason: 'lifecycle_disable',
    });
    expect(mocks.revokeAll).toHaveBeenCalledWith('user1', 'lifecycle_disable');
    expect(result.providerSessionsDestroyed).toBe(1);
    expect(result.providerLogoutsReconciliationRequired).toBe(0);
  });
});
