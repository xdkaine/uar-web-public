import { describe, expect, it } from 'vitest';
import { toSafeAccessRequestResponse } from './access-request-response';

describe('toSafeAccessRequestResponse', () => {
  it('removes every credential and verification-token field without mutating the source', () => {
    const source = {
      id: 'request-1',
      email: 'person@example.edu',
      accountPassword: 'encrypted-password',
      verificationToken: 'plaintext-token',
      verificationTokenHash: 'hashed-token',
      status: 'approved',
    };

    expect(toSafeAccessRequestResponse(source)).toEqual({
      id: 'request-1',
      email: 'person@example.edu',
      status: 'approved',
    });
    expect(source.accountPassword).toBe('encrypted-password');
    expect(source.verificationToken).toBe('plaintext-token');
    expect(source.verificationTokenHash).toBe('hashed-token');
  });
});
