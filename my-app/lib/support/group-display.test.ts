import { describe, expect, it } from 'vitest';
import { cnFromDn, describeGroup, formatGroupPath } from './group-display';

describe('cnFromDn', () => {
  it('extracts the CN value', () => {
    expect(cnFromDn('CN=CPTC,OU=KaminoGroups,DC=sdc,DC=cpp')).toBe('CPTC');
  });

  it('unescapes escaped commas', () => {
    expect(cnFromDn('CN=Smith\\, John,OU=Groups,DC=sdc,DC=cpp')).toBe('Smith, John');
  });

  it('returns null for non-CN leaf DNs and garbage', () => {
    expect(cnFromDn('OU=KaminoGroups,DC=sdc,DC=cpp')).toBeNull();
    expect(cnFromDn('')).toBeNull();
    expect(cnFromDn('not-a-dn')).toBeNull();
  });
});

describe('describeGroup', () => {
  it('prefers a stored friendly name and derives the parent path', () => {
    const info = describeGroup({
      dn: 'CN=CPTC,OU=KaminoGroups,DC=sdc,DC=cpp',
      name: 'Cyber Protection Team',
    });
    expect(info.displayName).toBe('Cyber Protection Team');
    expect(info.containerName).toBe('CPTC');
    expect(info.path).toEqual(['sdc.cpp', 'KaminoGroups']);
  });

  it('falls back to the container name when the name is the raw DN', () => {
    const dn = 'CN=CPTC,OU=KaminoGroups,DC=sdc,DC=cpp';
    const info = describeGroup({ dn, name: dn });
    expect(info.displayName).toBe('CPTC');
  });

  it('falls back to the container name when no name is stored', () => {
    const info = describeGroup({ dn: 'CN=Helpdesk,OU=Groups,DC=sdc,DC=cpp' });
    expect(info.displayName).toBe('Helpdesk');
    expect(info.path).toEqual(['sdc.cpp', 'Groups']);
  });

  it('never renders a DN-shaped stored name', () => {
    const info = describeGroup({
      dn: 'CN=Analysts,OU=Groups,DC=sdc,DC=cpp',
      name: 'CN=Something,OU=Else,DC=sdc,DC=cpp',
    });
    expect(info.displayName).toBe('Analysts');
  });

  it('returns the DN as displayName when the DN has no CN', () => {
    const dn = 'OU=KaminoGroups,DC=sdc,DC=cpp';
    expect(describeGroup({ dn }).displayName).toBe(dn);
  });
});

describe('formatGroupPath', () => {
  it('joins segments root-first', () => {
    expect(formatGroupPath(['sdc.cpp', 'KaminoGroups'])).toBe('sdc.cpp \u203a KaminoGroups');
    expect(formatGroupPath([])).toBe('');
  });
});
