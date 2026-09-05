import { describe, expect, it } from 'vitest';
import { shouldAutomaticallyStartOidc } from './login-selection';

describe('single-method OIDC continuation', () => {
  it('continues only on a clean login entry', () => {
    const oidc = [{ id: 'oidc' as const }];
    expect(shouldAutomaticallyStartOidc(oidc, '')).toBe(true);
    expect(shouldAutomaticallyStartOidc(oidc, 'Sign-in is currently disabled.')).toBe(false);
    expect(shouldAutomaticallyStartOidc(oidc, 'The configured auth service is unavailable.')).toBe(false);
  });

  it('does not auto-continue a chooser or a credential form', () => {
    expect(shouldAutomaticallyStartOidc([
      { id: 'oidc' },
      { id: 'native_ad' },
    ], '')).toBe(false);
    expect(shouldAutomaticallyStartOidc([{ id: 'native_ad' }], '')).toBe(false);
  });
});
