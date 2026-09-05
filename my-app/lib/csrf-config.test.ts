import { describe, expect, it } from 'vitest';
import { isCsrfExempt, requiresCsrfValidation } from './csrf-config';

it('protects initial login and password-change POSTs against login CSRF', () => {
  expect(isCsrfExempt('/api/auth/login')).toBe(false);
  expect(isCsrfExempt('/api/auth/complete-required-password-change')).toBe(false);
  expect(requiresCsrfValidation('POST')).toBe(true);
});

describe('cron CSRF policy', () => {
  it('lets bearer-authenticated cron routes bypass browser CSRF validation', () => {
    expect(isCsrfExempt('/api/cron/process-offboard-campaigns')).toBe(true);
    expect(requiresCsrfValidation('POST')).toBe(true);
  });
});

describe('back-channel logout CSRF policy', () => {
  it('exempts the actual IdP logout_token receiver route from browser CSRF validation', () => {
    expect(isCsrfExempt('/api/auth/oidc/backchannel-logout')).toBe(true);
    expect(requiresCsrfValidation('POST')).toBe(true);
  });

  it('no longer exempts the retired /api/auth/idp receiver path', () => {
    expect(isCsrfExempt('/api/auth/idp/backchannel-logout')).toBe(false);
  });

  it('does not let prefix siblings ride an exemption', () => {
    expect(isCsrfExempt('/api/auth/login-history')).toBe(false);
    expect(isCsrfExempt('/api/cronx/run')).toBe(false);
  });

  it('still covers nested paths under exempt prefixes', () => {
    expect(isCsrfExempt('/api/cron/process-offboard-campaigns')).toBe(true);
    expect(isCsrfExempt('/api/verify/confirm')).toBe(true);
  });
});
