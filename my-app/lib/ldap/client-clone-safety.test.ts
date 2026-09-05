import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Client } from 'ldapts';
import { protectLDAPClientForProductionClone } from './client';

const originalValue = process.env.PORTAL_CLONE_READ_ONLY;

afterEach(() => {
  if (originalValue === undefined) delete process.env.PORTAL_CLONE_READ_ONLY;
  else process.env.PORTAL_CLONE_READ_ONLY = originalValue;
});

describe('LDAP production-clone guard', () => {
  it('allows reads but rejects mutations before reaching the client', async () => {
    process.env.PORTAL_CLONE_READ_ONLY = 'true';
    const search = vi.fn().mockResolvedValue({ searchEntries: [] });
    const modify = vi.fn().mockResolvedValue(undefined);
    const client = protectLDAPClientForProductionClone({ search, modify } as unknown as Client);

    await expect(client.search('dc=example,dc=test', { scope: 'sub' })).resolves.toEqual({
      searchEntries: [],
    });
    await expect(Promise.resolve().then(() => client.modify('dn', []))).rejects.toThrow(
      'External ldap-write side effects are disabled'
    );
    expect(modify).not.toHaveBeenCalled();
  });
});
