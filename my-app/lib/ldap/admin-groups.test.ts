import { describe, expect, it } from 'vitest';
import { isMemberOfAdminGroup, parseAdminGroupDns } from './admin-groups';

const DOMAIN_ADMINS_DN = 'CN=Domain Admins,CN=Users,DC=example,DC=test';

describe('LDAP administrator group configuration', () => {
  it('matches a complete DN across attribute and value case differences', () => {
    expect(
      isMemberOfAdminGroup(
        ['cn=domain admins,cn=users,dc=EXAMPLE,dc=TEST'],
        DOMAIN_ADMINS_DN
      )
    ).toBe(true);
  });

  it('normalizes equivalent escaped characters in complete DNs', () => {
    expect(
      isMemberOfAdminGroup(
        ['CN=Tier\\, One Admins,OU=Groups,DC=example,DC=test'],
        JSON.stringify([
          'CN=Tier\\2C One Admins,OU=Groups,DC=example,DC=test',
        ])
      )
    ).toBe(true);
  });

  it('normalizes equivalent Unicode representations', () => {
    expect(
      isMemberOfAdminGroup(
        ['CN=Gru\u0308ppe Admins,OU=Groups,DC=example,DC=test'],
        JSON.stringify([
          'CN=Grüppe Admins,OU=Groups,DC=example,DC=test',
        ])
      )
    ).toBe(true);
  });

  it.each([
    'CN=Faculty,CN=Users,DC=example,DC=test',
    'CN=Domain Admins Backup,CN=Users,DC=example,DC=test',
    'CN=Domain Admins,OU=Other Groups,DC=example,DC=test',
  ])('does not match a different complete DN: %s', (membership) => {
    expect(isMemberOfAdminGroup([membership], DOMAIN_ADMINS_DN)).toBe(false);
  });

  it('matches each exact group in a JSON array', () => {
    const configuration = JSON.stringify([
      'CN=Portal Administrators,OU=Groups,DC=example,DC=test',
      DOMAIN_ADMINS_DN,
    ]);

    expect(
      isMemberOfAdminGroup(
        ['CN=Portal Administrators,OU=Groups,DC=example,DC=test'],
        configuration
      )
    ).toBe(true);
    expect(isMemberOfAdminGroup([DOMAIN_ADMINS_DN], configuration)).toBe(true);
  });

  it('accepts one legacy complete DN', () => {
    expect(parseAdminGroupDns(DOMAIN_ADMINS_DN)).toHaveLength(1);
  });

  it.each([
    'CN=Domain Admins,CN=Administrators,CN=Schema Admins',
    'CN=Domain Admins;DC=example',
    '["CN=Domain Admins,CN=Users,DC=example,DC=test"',
    '[]',
    '["CN=Domain Admins,CN=Users,DC=example,DC=test", 42]',
    '["CN=Domain Admins"]',
    '["CN=Domain Admins,OU=Groups,DC=example,DC=test\\\\"]',
    '["CN=#04024869,OU=Groups,DC=example,DC=test"]',
  ])('rejects ambiguous or malformed configuration: %s', (configuration) => {
    expect(() => parseAdminGroupDns(configuration)).toThrow();
  });
});
