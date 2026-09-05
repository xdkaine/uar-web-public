import { describe, expect, it } from 'vitest';
import { getLoginRedirectTarget, getSafeRelativeRedirect } from './safe-redirect';

describe('getSafeRelativeRedirect', () => {
  it.each([
    'javascript:alert(1)',
    'JaVaScRiPt:alert(1)',
    'data:text/html,unsafe',
    'https://attacker.test/path',
    '//attacker.test/path',
    '/\\attacker.test/path',
    '/%5cattacker.test/path',
    '/%0ajavascript:alert(1)',
    ' /admin',
  ])('rejects unsafe redirect %j', (redirect) => {
    expect(getSafeRelativeRedirect(redirect)).toBeNull();
  });

  it.each([
    ['/instructions', '/instructions'],
    ['/admin/requests?status=pending#queue', '/admin/requests?status=pending#queue'],
  ])('preserves legitimate relative redirect %j', (redirect, expected) => {
    expect(getSafeRelativeRedirect(redirect)).toBe(expected);
  });
});

describe('getLoginRedirectTarget', () => {
  it('keeps non-admin users out of normalized admin destinations', () => {
    expect(getLoginRedirectTarget('/other/../admin/requests', false)).toBe('/instructions');
  });

  it('preserves an administrator destination for administrators', () => {
    expect(getLoginRedirectTarget('/admin/requests?status=pending', true))
      .toBe('/admin/requests?status=pending');
  });

  it('preserves a legitimate support destination for non-admin users', () => {
    expect(getLoginRedirectTarget('/support/tickets/ticket-1', false))
      .toBe('/support/tickets/ticket-1');
  });

  it.each([false, true])('never returns a hostile query value for isAdmin=%j', (isAdmin) => {
    const target = getLoginRedirectTarget('javascript:alert(1)', isAdmin);
    expect(target).toBe(isAdmin ? '/admin' : '/instructions');
    expect(target).not.toContain('javascript:');
  });
});
