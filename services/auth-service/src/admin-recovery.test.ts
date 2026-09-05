import { describe, expect, it } from 'vitest';
import {
  hashRecoveryPassword,
  normalizeRecoveryUsername,
  validateRecoveryPassword,
  verifyRecoveryPassword,
} from './admin-recovery';

describe('Auth Manager recovery credentials', () => {
  it('normalizes a bounded safe username', () => {
    expect(normalizeRecoveryUsername(' Recovery.Admin@Example.TEST ')).toBe(
      'recovery.admin@example.test'
    );
    expect(normalizeRecoveryUsername('<script>')).toBeNull();
    expect(normalizeRecoveryUsername('ab')).toBeNull();
  });

  it('requires a substantial control-free password', () => {
    expect(validateRecoveryPassword('correct horse battery staple')).toBe(true);
    expect(validateRecoveryPassword('too-short')).toBe(false);
    expect(validateRecoveryPassword(`valid-length-but\ncontrol`)).toBe(false);
  });

  it('stores scrypt credentials with a random salt', () => {
    const first = hashRecoveryPassword('correct horse battery staple');
    const second = hashRecoveryPassword('correct horse battery staple');
    expect(first).not.toBe(second);
    expect(verifyRecoveryPassword('correct horse battery staple', first)).toBe(true);
    expect(verifyRecoveryPassword('wrong horse battery staple', first)).toBe(false);
    expect(verifyRecoveryPassword('anything', 'scrypt$1$1$1$bad$bad')).toBe(false);
  });
});
