import { describe, expect, it } from 'vitest';
import { isValidAddress } from './email-list-validation';

describe('isValidAddress', () => {
  it('accepts an address after trimming surrounding whitespace', () => {
    expect(isValidAddress(' person@example.edu ')).toBe(true);
  });

  it('rejects incomplete and multi-address values', () => {
    expect(isValidAddress('person@example')).toBe(false);
    expect(isValidAddress('one@example.edu,two@example.edu')).toBe(false);
  });
});
