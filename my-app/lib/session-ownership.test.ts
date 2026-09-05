import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  sessionFindMany: vi.fn(),
  sessionDeleteMany: vi.fn(),
  sessionCreate: vi.fn(),
  providerCreateMany: vi.fn(),
  accessRequestFindMany: vi.fn(),
  batchAccountItemFindMany: vi.fn(),
}));

vi.mock('./prisma', () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

import { createUserSession, revokeAllSessionsForUser } from './session';
import { localCredentialVersion } from './auth/local-credential-version';

const createdSession = {
  id: 'session-new',
  username: 'fixture-user',
  isAdmin: false,
  expiresAt: new Date('2026-08-30T00:00:00.000Z'),
  lastActivity: new Date('2026-08-29T00:00:00.000Z'),
  authProvider: 'oidc',
};

beforeEach(() => {
  vi.clearAllMocks();
  const tx = {
    $queryRaw: mocks.queryRaw,
    session: {
      findMany: mocks.sessionFindMany,
      deleteMany: mocks.sessionDeleteMany,
      create: mocks.sessionCreate,
    },
    providerLogoutTask: { createMany: mocks.providerCreateMany },
    accessRequest: { findMany: mocks.accessRequestFindMany },
    batchAccountItem: { findMany: mocks.batchAccountItemFindMany },
  };
  mocks.transaction.mockImplementation(async (callback) => callback(tx));
  mocks.queryRaw.mockResolvedValue([]);
  mocks.sessionDeleteMany.mockResolvedValue({ count: 1 });
  mocks.sessionCreate.mockResolvedValue(createdSession);
  mocks.providerCreateMany.mockResolvedValue({ count: 1 });
  mocks.accessRequestFindMany.mockResolvedValue([]);
  mocks.batchAccountItemFindMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('session ownership serialization', () => {
  it('locks and revalidates the verified local credential before minting', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { passwordHash: 'current-hash', isActive: true, purpose: 'break_glass' },
    ]);
    mocks.sessionFindMany.mockResolvedValue([]);

    await createUserSession('Ops@Local', true, undefined, undefined, 'local_manual', undefined, localCredentialVersion('current-hash'));

    expect(String(mocks.queryRaw.mock.calls[1][0])).toContain('FOR UPDATE');
    expect(mocks.queryRaw.mock.calls[1][1]).toBe('ops@local');
    expect(mocks.queryRaw.mock.invocationCallOrder[1]).toBeLessThan(mocks.sessionCreate.mock.invocationCallOrder[0]);
  });

  it.each([
    [{ passwordHash: 'rotated-hash', isActive: true, purpose: 'break_glass' }],
    [{ passwordHash: 'current-hash', isActive: false, purpose: 'break_glass' }],
    [{ passwordHash: 'current-hash', isActive: true, purpose: 'ordinary' }],
    [],
  ])('rejects rotated, disabled, wrong-purpose, or deleted local credentials', async (...rows) => {
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce(rows);

    await expect(createUserSession('ops@local', true, undefined, undefined, 'local_manual', undefined, localCredentialVersion('current-hash')))
      .rejects.toThrow('Local sign-in is no longer valid');
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('rejects a manual local session without a credential-version proof', async () => {
    mocks.queryRaw.mockResolvedValueOnce([]).mockResolvedValueOnce([
      { passwordHash: 'current-hash', isActive: true, purpose: 'break_glass' },
    ]);
    await expect(createUserSession('ops@local', true, undefined, undefined, 'local_manual'))
      .rejects.toThrow('Local sign-in is no longer valid');
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('keeps an explicitly verified OIDC-local issuance valid without a sid or direct proof', async () => {
    mocks.sessionFindMany.mockResolvedValue([]);

    await createUserSession('ops@local', true, undefined, undefined, 'local', undefined, undefined, 'oidc_verified');

    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.sessionCreate).toHaveBeenCalled();
  });
  it('takes the per-user advisory lock and records replaced IdP sessions before deleting them', async () => {
    mocks.sessionFindMany.mockResolvedValue([{ providerSid: 'provider-old' }]);

    await createUserSession('fixture-user', false, undefined, undefined, 'oidc', 'provider-new');

    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.providerCreateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: [expect.objectContaining({
        username: 'fixture-user',
        providerSid: 'provider-old',
        reason: 'session_replaced_by_login',
      })],
      skipDuplicates: true,
    }));
    expect(mocks.providerCreateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sessionDeleteMany.mock.invocationCallOrder[0]
    );
  });

  it('caps an OIDC portal session at the signed provider-session expiry', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-29T00:00:00.000Z'));
    delete process.env.AUTH_OIDC_SESSION_MAX_AGE;
    mocks.sessionFindMany.mockResolvedValue([]);
    const providerExpiry = new Date('2026-08-29T01:00:00.000Z');

    await createUserSession(
      'fixture-user', false, undefined, undefined, 'oidc', 'provider-new',
      undefined, 'direct', providerExpiry,
    );

    expect(mocks.sessionCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ expiresAt: providerExpiry }),
    }));
  });

  it('blocks a case-variant session after a governed account is deleted', async () => {
    mocks.accessRequestFindMany.mockResolvedValue([{
      id: 'request-1', status: 'approved', adAccountStatus: 'deleted',
    }]);

    await expect(createUserSession('Fixture-User', false, undefined, undefined, 'oidc', 'provider-new'))
      .rejects.toThrow('disabled or deleted');
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
    expect(mocks.accessRequestFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: expect.arrayContaining([
          { ldapUsername: { equals: 'Fixture-User', mode: 'insensitive' } },
        ]),
      }),
    }));
  });

  it('blocks a case-variant session after a batch-governed account is disabled', async () => {
    mocks.batchAccountItemFindMany.mockResolvedValue([{
      id: 'batch-item-1', adAccountStatus: 'disabled',
    }]);

    await expect(createUserSession('Fixture-User', false, undefined, undefined, 'oidc', 'provider-new'))
      .rejects.toThrow('batch-governed directory account is disabled or deleted');
    expect(mocks.sessionCreate).not.toHaveBeenCalled();
  });

  it('takes the same per-user advisory lock before revoke-all snapshots and deletes', async () => {
    mocks.sessionFindMany.mockResolvedValue([{ id: 'session-old', username: 'fixture-user', providerSid: 'provider-old' }]);

    const revoked = await revokeAllSessionsForUser('fixture-user', 'offboard_enforcement');

    expect(revoked).toEqual([{ id: 'session-old', username: 'fixture-user', providerSid: 'provider-old' }]);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sessionFindMany.mock.invocationCallOrder[0]
    );
    expect(mocks.providerCreateMany.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sessionDeleteMany.mock.invocationCallOrder[0]
    );
  });
});
