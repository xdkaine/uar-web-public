import { afterEach, describe, expect, it } from 'vitest';

import {
  getOidcAlternateSignInPolicy,
  getOidcSignInMethods,
  isOidcAlternateSignInMethodAllowed,
} from './alternate-signin';

describe('OIDC alternate sign-in policy', () => {
  afterEach(() => delete process.env.AUTH_OIDC_ALTERNATE_SIGNIN);

  it('defaults unknown and missing policies to central OIDC only', () => {
    expect(getOidcAlternateSignInPolicy()).toBe('off');
    expect(getOidcSignInMethods()).toEqual(['oidc']);

    process.env.AUTH_OIDC_ALTERNATE_SIGNIN = 'always';
    expect(getOidcAlternateSignInPolicy()).toBe('off');
    expect(getOidcSignInMethods()).toEqual(['oidc']);
  });

  it.each([
    ['native', ['oidc', 'native_ad']],
    ['local', ['oidc', 'local_break_glass']],
    ['native_and_local', ['oidc', 'native_ad', 'local_break_glass']],
  ] as const)('maps %s to its exact server-authorized methods', (policy, expected) => {
    process.env.AUTH_OIDC_ALTERNATE_SIGNIN = policy;
    expect(getOidcSignInMethods()).toEqual(expected);
  });

  it('never treats the browser-selected provider as authorization', () => {
    process.env.AUTH_OIDC_ALTERNATE_SIGNIN = 'local';
    expect(isOidcAlternateSignInMethodAllowed('native_ad')).toBe(false);
    expect(isOidcAlternateSignInMethodAllowed('local_break_glass')).toBe(true);
  });
});
