import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { buildSuggestionFilter, classifyDirectoryObject } from './directory-probe';
import {
  buildCandidateUrls,
  parseLdapUrl,
  resetLdapHealthCache,
  selectHealthyLdapUrl,
} from './url-health';

describe('classifyDirectoryObject', () => {
  it.each([
    [['top', 'group'], 'group'],
    [['organizationalUnit', 'top'], 'organizationalUnit'],
    [['person', 'organizationalPerson', 'user'], 'user'],
    [['container', 'top'], 'container'],
    [['domainDNS'], 'domain'],
    [['device'], 'other'],
    [[], null],
    [undefined, null],
  ])('classifies %j as %s', (input, expected) => {
    expect(classifyDirectoryObject(input)).toBe(expected);
  });
});

describe('buildSuggestionFilter', () => {
  it('builds a group filter around the term', () => {
    expect(buildSuggestionFilter('group', 'soc')).toBe('(&(objectClass=group)(cn=*soc*))');
  });

  it('escapes LDAP filter metacharacters in the term', () => {
    const filter = buildSuggestionFilter('ou', 'a)(cn=x');
    expect(filter).not.toContain('a)(cn=x');
    expect(filter.startsWith('(&(objectClass=organizationalUnit)(cn=*')).toBe(true);
    expect(filter.endsWith('*))')).toBe(true);
  });
});

describe('parseLdapUrl', () => {
  it('parses an ldaps URL with default port', () => {
    expect(parseLdapUrl('ldaps://dc1.sdc.cpp')).toEqual({
      url: 'ldaps://dc1.sdc.cpp',
      host: 'dc1.sdc.cpp',
      port: 636,
    });
  });

  it.each(['ldap://insecure', 'https://nope', 'not a url', 'ldaps://host:notaport'])(
    'rejects %s',
    (input) => {
      expect(parseLdapUrl(input)).toBeNull();
    }
  );
});

describe('buildCandidateUrls', () => {
  it('keeps the primary first, dedupes, and drops invalid failover entries', () => {
    expect(
      buildCandidateUrls('ldaps://primary:636', [
        'ldaps://secondary:636',
        'ldaps://primary:636',
        'http://bogus',
        '',
        'ldaps://tertiary',
      ])
    ).toEqual(['ldaps://primary:636', 'ldaps://secondary:636', 'ldaps://tertiary']);
  });

  it('returns only the primary when nothing else is valid', () => {
    expect(buildCandidateUrls('ldaps://only:636', ['garbage'])).toEqual(['ldaps://only:636']);
  });
});

describe('selectHealthyLdapUrl', () => {
  const tlsOptions = { rejectUnauthorized: false };

  beforeEach(() => {
    resetLdapHealthCache();
  });

  afterEach(() => {
    resetLdapHealthCache();
  });

  it('short-circuits without probing a single candidate', async () => {
    let probes = 0;
    const url = await selectHealthyLdapUrl(['ldaps://only:636'], tlsOptions, async () => {
      probes += 1;
      return false;
    });
    expect(url).toBe('ldaps://only:636');
    expect(probes).toBe(0);
  });

  it('picks the primary when healthy and caches the result', async () => {
    let probes = 0;
    const candidates = ['ldaps://a:636', 'ldaps://b:636'];
    const prober = async () => {
      probes += 1;
      return true;
    };
    expect(await selectHealthyLdapUrl(candidates, tlsOptions, prober)).toBe('ldaps://a:636');
    expect(await selectHealthyLdapUrl(candidates, tlsOptions, prober)).toBe('ldaps://a:636');
    expect(probes).toBe(1);
  });

  it('falls back to the next endpoint when the primary refuses connections', async () => {
    const candidates = ['ldaps://a:636', 'ldaps://b:636'];
    const prober = async (endpoint: { host: string }) => endpoint.host === 'b';
    expect(await selectHealthyLdapUrl(candidates, tlsOptions, prober)).toBe('ldaps://b:636');
  });

  it('returns the primary when nothing is reachable so historical errors surface', async () => {
    const url = await selectHealthyLdapUrl(['ldaps://a:636', 'ldaps://b:636'], tlsOptions, async () => false);
    expect(url).toBe('ldaps://a:636');
  });
});
