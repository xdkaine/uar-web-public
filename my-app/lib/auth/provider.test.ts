import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticateLDAP: vi.fn(),
  localAccountFindFirst: vi.fn(),
  localAccountUpdate: vi.fn(),
}));
vi.mock('@/lib/ldap', () => ({ authenticateLDAP: mocks.authenticateLDAP }));
vi.mock('@/lib/prisma', () => ({ prisma: { localAccount: {
  findFirst: mocks.localAccountFindFirst,
  update: mocks.localAccountUpdate,
} } }));
vi.mock('@/lib/logger', () => ({ appLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { authenticateDirectoryOnly, authenticateLocalOnly } from './provider';
import { hashPassword } from './password-hash';

describe('isolated portal credential providers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.localAccountUpdate.mockResolvedValue({});
  });

  it('returns an Active Directory transport failure without consulting portal local accounts', async () => {
    const timeout = { success: false, status: 'timeout', error: 'directory unavailable' };
    mocks.authenticateLDAP.mockResolvedValue(timeout);
    const outcome = await authenticateDirectoryOnly('alice', 'password');
    expect(outcome).toEqual({ kind: 'ad', result: timeout });
    expect(mocks.localAccountFindFirst).not.toHaveBeenCalled();
  });

  it('local authentication never contacts Active Directory', async () => {
    mocks.localAccountFindFirst.mockResolvedValue({
      id: 'local-1',
      passwordHash: await hashPassword('Portal-Local-Pass-9!'),
      isActive: true,
    });
    const outcome = await authenticateLocalOnly('ops@local', 'Portal-Local-Pass-9!');
    expect(outcome).toMatchObject({ kind: 'local', username: 'ops@local' });
    expect(mocks.authenticateLDAP).not.toHaveBeenCalled();
  });

  it('keeps disabled local accounts unusable with a generic outcome', async () => {
    mocks.localAccountFindFirst.mockResolvedValue({
      id: 'local-1', passwordHash: 'scrypt$16384$8$1$aaaa$bbbb', isActive: false,
    });
    await expect(authenticateLocalOnly('ops@local', 'anything')).resolves.toEqual({ kind: 'unavailable' });
    expect(mocks.authenticateLDAP).not.toHaveBeenCalled();
  });
});
