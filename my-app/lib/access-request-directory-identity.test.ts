import { describe, expect, it } from 'vitest';

import { isAccessRequestDirectoryIdentityConsistent } from './access-request-directory-identity';

describe('isAccessRequestDirectoryIdentityConsistent', () => {
  it.each([
    [{ ldapUsername: null, linkedAdUsername: null }],
    [{ ldapUsername: ' Person1 ', linkedAdUsername: null }],
    [{ ldapUsername: 'Person1', linkedAdUsername: ' person1 ' }],
  ])('accepts zero, one, or case-equivalent aliases', (request) => {
    expect(isAccessRequestDirectoryIdentityConsistent(request)).toBe(true);
  });

  it('rejects divergent nonblank aliases', () => {
    expect(isAccessRequestDirectoryIdentityConsistent({
      ldapUsername: 'person1', linkedAdUsername: 'reused-person1',
    })).toBe(false);
  });
});
