import { describe, expect, it } from 'vitest';

import { getConfigDefinition } from './registry';

describe('ldap administrator group configuration', () => {
  const definition = getConfigDefinition('ldap.adminGroups')!;

  it('treats a complete distinguished name as one item', () => {
    expect(definition.validate('CN=svc_uar_breakglass_administrator,OU=KaminoGroups,DC=sdc,DC=cpp')).toEqual([
      'CN=svc_uar_breakglass_administrator,OU=KaminoGroups,DC=sdc,DC=cpp',
    ]);
  });

  it('accepts multiple complete distinguished names as an array', () => {
    expect(
      definition.validate([
        'CN=UAR Administrators,OU=Groups,DC=sdc,DC=cpp',
        'CN=UAR Support,OU=Groups,DC=sdc,DC=cpp',
      ]),
    ).toHaveLength(2);
  });
});
