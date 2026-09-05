import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  tokenCreate: vi.fn(),
  tokenFindUnique: vi.fn(),
  tokenFindFirst: vi.fn(),
  tokenUpdateMany: vi.fn(),
  transaction: vi.fn(),
  accessRequestUpdateMany: vi.fn(),
  vpnFindUnique: vi.fn(),
  vpnCreate: vi.fn(),
  vpnLogCreate: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    profileEmailVerificationToken: {
      create: mocks.tokenCreate,
      findUnique: mocks.tokenFindUnique,
      updateMany: mocks.tokenUpdateMany,
    },
    $transaction: mocks.transaction,
  },
}));

import {
  claimProfileEmailToken,
  completeProfileEmailVerification,
  createIssuingProfileEmailToken,
  hashProfileEmailToken,
  activateDeliveredProfileEmailToken,
} from './profile-email-verification';

function storedToken(overrides: Record<string, unknown> = {}) {
  return {
    id: 'token-1',
    tokenHash: hashProfileEmailToken('raw-link-token'),
    desiredEmail: 'alice@cpp.edu',
    expiresAt: new Date('2026-08-29T00:00:00Z'),
    status: 'pending',
    claimedUntil: null,
    accessRequest: {
      id: 'request-1',
      version: 4,
      name: 'Alice Example',
      email: 'alice@cpp.edu',
      ldapUsername: 'alice',
      vpnUsername: 'alice',
      isVerified: false,
      isGrandfatheredAccount: true,
      status: 'pending_verification',
    },
    ...overrides,
  };
}

describe('profile email verification token lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tokenUpdateMany.mockResolvedValue({ count: 1 });
    mocks.transaction.mockImplementation(async (work) => work({
      $queryRaw: mocks.queryRaw,
      accessRequest: { updateMany: mocks.accessRequestUpdateMany },
      vPNAccount: { findUnique: mocks.vpnFindUnique, create: mocks.vpnCreate },
      vPNAccountStatusLog: { create: mocks.vpnLogCreate },
      profileEmailVerificationToken: {
        findUnique: mocks.tokenFindUnique,
        findFirst: mocks.tokenFindFirst,
        updateMany: mocks.tokenUpdateMany,
      },
    }));
    mocks.queryRaw.mockResolvedValue([]);
    mocks.tokenFindFirst.mockResolvedValue(null);
  });

  it('persists only a hash while a new link is being delivered', async () => {
    mocks.tokenCreate.mockResolvedValue({ id: 'token-1' });

    await createIssuingProfileEmailToken({
      accessRequestId: 'request-1',
      rawToken: 'raw-link-token',
      desiredEmail: 'alice@cpp.edu',
      now: new Date('2026-08-28T00:00:00Z'),
    });

    expect(mocks.tokenCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tokenHash: hashProfileEmailToken('raw-link-token'),
        status: 'issuing',
      }),
    });
    expect(JSON.stringify(mocks.tokenCreate.mock.calls[0][0])).not.toContain('raw-link-token');
  });

  it('binds a claim to the authenticated directory username', async () => {
    mocks.tokenFindUnique.mockResolvedValue(storedToken());

    await expect(claimProfileEmailToken({
      rawToken: 'raw-link-token',
      sessionUsername: 'mallory',
      now: new Date('2026-08-28T00:00:00Z'),
    })).resolves.toEqual({ ok: false, reason: 'unauthorized' });
    expect(mocks.tokenUpdateMany).not.toHaveBeenCalled();
  });

  it('uses a lease CAS so a second consumer sees the link in progress', async () => {
    mocks.tokenFindUnique.mockResolvedValue(storedToken());
    mocks.tokenUpdateMany.mockResolvedValue({ count: 0 });

    await expect(claimProfileEmailToken({
      rawToken: 'raw-link-token',
      sessionUsername: 'ALICE',
      now: new Date('2026-08-28T00:00:00Z'),
    })).resolves.toEqual({ ok: false, reason: 'in_progress' });
  });

  it('refuses to activate a replacement while an older confirmation owns the request lock', async () => {
    mocks.tokenFindFirst.mockResolvedValue({ id: 'older-claim' });

    await expect(activateDeliveredProfileEmailToken({
      tokenId: 'token-2',
      accessRequestId: 'request-1',
      desiredEmail: 'new@cpp.edu',
      expectedRequestVersion: 4,
    })).rejects.toThrow('already being finalized');

    expect(mocks.accessRequestUpdateMany).not.toHaveBeenCalled();
  });

  it('finalizes portal and VPN state only from the claimed directory-applied state', async () => {
    mocks.accessRequestUpdateMany.mockResolvedValue({ count: 1 });
    mocks.vpnFindUnique.mockResolvedValue(null);
    mocks.vpnCreate.mockResolvedValue({ id: 'vpn-1' });
    mocks.tokenUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 2 });

    await expect(completeProfileEmailVerification({
      tokenId: 'token-1',
      claimId: 'claim-1',
      accessRequestId: 'request-1',
      expectedRequestVersion: 4,
      desiredEmail: 'alice@cpp.edu',
      vpnUsername: 'alice',
      displayName: 'Alice Example',
      ldapUsername: 'alice',
    })).resolves.toBe(true);

    expect(mocks.accessRequestUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'request-1', version: 4, isVerified: false }),
      data: expect.objectContaining({ isVerified: true, version: { increment: 1 } }),
    }));
    expect(mocks.tokenUpdateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: 'token-1', claimId: 'claim-1', status: 'directory_applied' },
      data: expect.objectContaining({ status: 'completed' }),
    }));
  });

  it('does not create VPN state after a stale request version loses the CAS', async () => {
    mocks.accessRequestUpdateMany.mockResolvedValue({ count: 0 });

    await expect(completeProfileEmailVerification({
      tokenId: 'token-1',
      claimId: 'claim-1',
      accessRequestId: 'request-1',
      expectedRequestVersion: 4,
      desiredEmail: 'alice@cpp.edu',
      vpnUsername: 'alice',
      displayName: 'Alice Example',
      ldapUsername: 'alice',
    })).resolves.toBe(false);
    expect(mocks.vpnCreate).not.toHaveBeenCalled();
    expect(mocks.tokenUpdateMany).not.toHaveBeenCalled();
  });
});
