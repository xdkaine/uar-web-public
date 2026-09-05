import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    passwordChangeChallenge: {
      updateMany: mocks.updateMany,
    },
  },
}));

import {
  claimPasswordChangeChallenge,
  createPasswordChangeChallenge,
  markPasswordChangeChallengeDirectoryApplied,
} from './password-change-challenge';

describe('claimPasswordChangeChallenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses one conditional active-to-processing update as the replay fence', async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(claimPasswordChangeChallenge('challenge-1')).resolves.toBe(true);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'challenge-1',
        state: 'active',
        used: false,
        expiresAt: { gt: expect.any(Date) },
        attempts: { lt: 5 },
      },
      data: {
        state: 'processing',
        claimedAt: expect.any(Date),
      },
    });
  });

  it('rejects a concurrent claimant when the conditional update changes no row', async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });

    await expect(claimPasswordChangeChallenge('challenge-1')).resolves.toBe(false);
  });

  it('records directory-applied recovery evidence as a conditional terminal state', async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(markPasswordChangeChallengeDirectoryApplied('challenge-1')).resolves.toBeUndefined();
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 'challenge-1', state: 'processing', used: false },
      data: {
        state: 'directory_applied',
        used: true,
        usedAt: expect.any(Date),
      },
    });
  });

  it('persists manual AD provenance for the continuation fence', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'challenge-2',
      tokenHash: 'hash',
      expiresAt: new Date(Date.now() + 60_000),
    });
    const prismaModule = await import('./prisma');
    Object.assign(prismaModule.prisma.passwordChangeChallenge, { create });

    await createPasswordChangeChallenge({
      username: 'alice',
      reason: 'password_change_required',
      authProvider: 'ad_manual',
      correlationId: 'manual-1',
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        authProvider: 'ad_manual',
        correlationId: 'manual-1',
      }),
    }));
  });
});
