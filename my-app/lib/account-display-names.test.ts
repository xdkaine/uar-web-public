import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ ldap: vi.fn(), requests: vi.fn(), batches: vi.fn(), vpn: vi.fn(), directory: vi.fn() }));
vi.mock('@/lib/ldap', () => ({ resolveLDAPUserDisplayNames: mocks.ldap }));
vi.mock('@/lib/prisma', () => ({ prisma: {
  accessRequest: { findMany: mocks.requests }, batchAccountItem: { findMany: mocks.batches },
  vPNAccount: { findMany: mocks.vpn }, directoryGroupMemberSnapshot: { findMany: mocks.directory },
} }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  mocks.ldap.mockResolvedValue(new Map());
  for (const mock of [mocks.requests, mocks.batches, mocks.vpn, mocks.directory]) mock.mockResolvedValue([]);
});
describe('account display names', () => {
  it('deduplicates exact usernames and caches display-only resolution', async () => {
    mocks.ldap.mockResolvedValue(new Map([['ada', 'Ada Lovelace']]));
    const { resolveAccountDisplayNames } = await import('./account-display-names');
    const names = await resolveAccountDisplayNames(['Ada', 'ada', ' ADA ']);
    expect(names.get('ada')).toBe('Ada Lovelace');
    expect(mocks.ldap).toHaveBeenCalledExactlyOnceWith(['ada']);
    await resolveAccountDisplayNames(['ada']);
    expect(mocks.ldap).toHaveBeenCalledTimes(1);
  });
  it('uses retained names for deleted accounts without guessing ambiguous identities', async () => {
    mocks.ldap.mockRejectedValue(new Error('Directory unavailable'));
    mocks.requests.mockResolvedValue([{ name: 'Retired Person', ldapUsername: 'retired' }, { name: 'Former Person', ldapUsername: 'reused' }]);
    mocks.batches.mockResolvedValue([{ name: 'Different Person', ldapUsername: 'reused' }]);
    const { resolveAccountDisplayNames } = await import('./account-display-names');
    const names = await resolveAccountDisplayNames(['retired', 'reused', 'unknown']);
    expect(names.get('retired')).toBe('Retired Person');
    expect(names.has('reused')).toBe(false);
    expect(names.has('unknown')).toBe(false);
  });
  it('does not relabel historical actions with a different current owner of a reused username', async () => {
    mocks.ldap.mockResolvedValue(new Map([['reused', 'New Person']]));
    mocks.requests.mockResolvedValue([{ name: 'Former Person', ldapUsername: 'reused' }]);
    const { resolveAccountDisplayNames } = await import('./account-display-names');
    expect((await resolveAccountDisplayNames(['reused'])).has('reused')).toBe(false);
  });
  it('bounds directory batches and never performs one lookup per row', async () => {
    const { resolveAccountDisplayNames } = await import('./account-display-names');
    await resolveAccountDisplayNames(Array.from({ length: 250 }, (_, i) => `user${i}`));
    expect(mocks.ldap.mock.calls.map(([names]) => names.length)).toEqual([100, 100, 50]);
  });
});
