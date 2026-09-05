import { describe, expect, it } from 'vitest';
import { classifyDirectoryQueryError } from './directory-fetch-state';

describe('classifyDirectoryQueryError', () => {
  it('classifies Active Directory size-limit failures without exposing their diagnostics', () => {
    expect(classifyDirectoryQueryError(Object.assign(
      new Error('LDAP result code 0x4 for CN=Sensitive Person,OU=People,DC=example,DC=test'),
      { code: '0x4' },
    ))).toBe('size_limit_error');
  });

  it('classifies connectivity failures as a directory query failure', () => {
    expect(classifyDirectoryQueryError(new Error('connect ETIMEDOUT 10.10.10.10:636'))).toBe('query_error');
  });
});
