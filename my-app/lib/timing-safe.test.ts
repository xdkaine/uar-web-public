import { describe, expect, it } from 'vitest';
import { bearerTokenMatches, timingSafeCompare } from './timing-safe';

describe('timingSafeCompare', () => {
  it('matches equal strings and rejects differing or empty ones', () => {
    expect(timingSafeCompare('same-secret', 'same-secret')).toBe(true);
    expect(timingSafeCompare('same-secret', 'diff-secret')).toBe(false);
    expect(timingSafeCompare('short', 'shorter!')).toBe(false);
    expect(timingSafeCompare('', 'nonempty')).toBe(false);
    expect(timingSafeCompare('nonempty', '')).toBe(false);
  });
});

describe('bearerTokenMatches', () => {
  const secret = 'cron-secret-with-at-least-32-characters';

  it('accepts the correct bearer token', () => {
    expect(bearerTokenMatches(`Bearer ${secret}`, secret)).toBe(true);
  });

  it('rejects wrong tokens without leaking via early success', () => {
    expect(bearerTokenMatches(`Bearer ${'x'.repeat(secret.length)}`, secret)).toBe(false);
    expect(bearerTokenMatches(`Bearer short`, secret)).toBe(false);
  });

  it('rejects missing header, empty secret, and non-bearer schemes', () => {
    expect(bearerTokenMatches(null, secret)).toBe(false);
    expect(bearerTokenMatches(undefined, secret)).toBe(false);
    expect(bearerTokenMatches('', secret)).toBe(false);
    expect(bearerTokenMatches(`Bearer ${secret}`, '')).toBe(false);
    expect(bearerTokenMatches(`Basic ${secret}`, secret)).toBe(false);
    expect(bearerTokenMatches(secret, secret)).toBe(false);
  });
});
