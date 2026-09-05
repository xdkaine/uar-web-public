import { describe, expect, it } from 'vitest';

import { ldapAccountIsEnabled } from './account-status';

describe('ldapAccountIsEnabled', () => {
  it('accepts a valid enabled AD userAccountControl value', () => {
    expect(ldapAccountIsEnabled([{ type: 'userAccountControl', values: ['512'] }])).toBe(true);
  });

  it.each(['514', '', 'not-a-number'])('fails closed for disabled or invalid value %j', (value) => {
    expect(ldapAccountIsEnabled([{ type: 'userAccountControl', values: [value] }])).toBe(false);
  });

  it('fails closed when the attribute is missing', () => {
    expect(ldapAccountIsEnabled([])).toBe(false);
  });
});
