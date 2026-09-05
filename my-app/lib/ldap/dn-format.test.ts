import { describe, expect, it } from 'vitest';
import { dnBreadcrumbSegments, prettyDnLabel, splitDnRdns } from './dn-format';

describe('splitDnRdns', () => {
  it('splits a standard DN into RDNs', () => {
    expect(splitDnRdns('CN=uar-bind,OU=Service Accounts,DC=sdc,DC=cpp')).toEqual([
      'CN=uar-bind',
      'OU=Service Accounts',
      'DC=sdc',
      'DC=cpp',
    ]);
  });

  it('honors escaped commas inside values', () => {
    expect(splitDnRdns('CN=Doe\\, John,OU=People,DC=example,DC=test')).toEqual([
      'CN=Doe\\, John',
      'OU=People',
      'DC=example',
      'DC=test',
    ]);
  });

  it('returns an empty list for blank input', () => {
    expect(splitDnRdns('   ')).toEqual([]);
  });
});

describe('prettyDnLabel', () => {
  it('renders a friendly root-first path with the domain leading', () => {
    expect(prettyDnLabel('CN=uar-bind,OU=Service Accounts,DC=sdc,DC=cpp')).toBe(
      'sdc.cpp › Service Accounts › uar-bind'
    );
  });

  it('renders a bare search base as domain plus OU', () => {
    expect(prettyDnLabel('DC=sdc,DC=cpp')).toBe('sdc.cpp');
    expect(prettyDnLabel('OU=People,DC=sdc,DC=cpp')).toBe('sdc.cpp › People');
  });

  it('falls back to the raw DN when no values parse', () => {
    expect(prettyDnLabel('weird')).toBe('weird');
  });
});

describe('dnBreadcrumbSegments', () => {
  it('orders segments root-first', () => {
    expect(dnBreadcrumbSegments('CN=uar-bind,OU=Service Accounts,DC=sdc,DC=cpp')).toEqual([
      'sdc.cpp',
      'Service Accounts',
      'uar-bind',
    ]);
  });
});
