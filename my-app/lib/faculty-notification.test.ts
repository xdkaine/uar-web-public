import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  commentCreate: vi.fn(),
  transaction: vi.fn(),
  sendFaculty: vi.fn(),
  sendVpn: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    accessRequest: { findUnique: mocks.findUnique, updateMany: mocks.updateMany },
    requestComment: { create: mocks.commentCreate },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/email', () => ({
  sendFacultyNotification: mocks.sendFaculty,
  sendVPNPendingFacultyNotification: mocks.sendVpn,
}));

import { deliverFacultyNotification } from './faculty-notification';

const requestRow = {
  id: 'request-1',
  version: 3,
  status: 'pending_faculty',
  isVerified: true,
  sentToFacultyAt: null,
  facultyNotificationState: null,
  facultyNotificationClaimId: null,
  facultyNotificationClaimedUntil: null,
  name: 'Test User',
  email: 'user@example.test',
  isInternal: true,
  needsDomainAccount: true,
  ldapUsername: 'testuser',
  vpnUsername: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findUnique.mockResolvedValue(requestRow);
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.sendFaculty.mockResolvedValue({ messageId: 'message-1' });
  mocks.transaction.mockImplementation(async (callback) => callback({
    accessRequest: { updateMany: mocks.updateMany, findUnique: mocks.findUnique },
    requestComment: { create: mocks.commentCreate },
  }));
});

describe('deliverFacultyNotification', () => {
  it('claims before sending and finalizes only with the same claim', async () => {
    const result = await deliverFacultyNotification({
      requestId: requestRow.id,
      actor: 'reviewer',
      recipients: ['faculty@example.test'],
      vpnModuleEnabled: false,
      expectedStatus: 'pending_faculty',
    });

    expect(result.status).toBe('delivered');
    expect(mocks.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ version: 3, sentToFacultyAt: null }),
      data: expect.objectContaining({ facultyNotificationState: 'sending' }),
    }));
    expect(mocks.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ version: 4, facultyNotificationState: 'sending' }),
      data: expect.objectContaining({ facultyNotificationState: 'delivered' }),
    }));
  });

  it('does not send when a concurrent worker wins the claim', async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await deliverFacultyNotification({
      requestId: requestRow.id,
      actor: 'reviewer',
      recipients: ['faculty@example.test'],
      vpnModuleEnabled: false,
      expectedStatus: 'pending_faculty',
    });
    expect(result.status).toBe('conflict');
    expect(mocks.sendFaculty).not.toHaveBeenCalled();
  });

  it('records an ambiguous transport failure and blocks automatic retry', async () => {
    mocks.sendFaculty.mockRejectedValue(new Error('socket closed after DATA'));
    const result = await deliverFacultyNotification({
      requestId: requestRow.id,
      actor: 'reviewer',
      recipients: ['faculty@example.test'],
      vpnModuleEnabled: false,
      expectedStatus: 'pending_faculty',
    });
    expect(result.status).toBe('delivery_unknown');
    expect(mocks.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ facultyNotificationState: 'sending' }),
      data: expect.objectContaining({
        facultyNotificationState: 'delivery_unknown',
        facultyNotificationClaimId: null,
      }),
    }));
  });

  it('moves an expired claim to unknown without resending', async () => {
    mocks.findUnique.mockResolvedValue({
      ...requestRow,
      facultyNotificationState: 'sending',
      facultyNotificationClaimId: 'stale-claim',
      facultyNotificationClaimedUntil: new Date(Date.now() - 1_000),
    });
    const result = await deliverFacultyNotification({
      requestId: requestRow.id,
      actor: 'reviewer',
      recipients: ['faculty@example.test'],
      vpnModuleEnabled: false,
      expectedStatus: 'pending_faculty',
    });
    expect(result.status).toBe('delivery_unknown');
    expect(mocks.sendFaculty).not.toHaveBeenCalled();
  });

  it('delivers the VPN handoff to every configured faculty recipient', async () => {
    mocks.sendVpn.mockResolvedValue({ messageId: 'message-vpn' });
    const result = await deliverFacultyNotification({
      requestId: requestRow.id,
      actor: 'reviewer',
      recipients: ['faculty-one@example.test', 'faculty-two@example.test'],
      vpnModuleEnabled: true,
      expectedStatus: 'pending_faculty',
    });

    expect(result.status).toBe('delivered');
    expect(mocks.sendVpn).toHaveBeenCalledTimes(2);
    expect(mocks.sendVpn).toHaveBeenNthCalledWith(1, 'faculty-one@example.test', expect.anything(), expect.anything(), expect.anything(), expect.anything(), 'reviewer');
    expect(mocks.sendVpn).toHaveBeenNthCalledWith(2, 'faculty-two@example.test', expect.anything(), expect.anything(), expect.anything(), expect.anything(), 'reviewer');
  });
});
