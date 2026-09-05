import { describe, expect, it } from 'vitest';

import {
  LOCAL_USERNAME_SUFFIX,
  canonicalizeBreakGlassUsername,
} from './local-username';

describe('canonicalizeBreakGlassUsername', () => {
  it('accepts a well-formed namespaced username', () => {
    expect(canonicalizeBreakGlassUsername('emergency-admin@local')).toBe(
      'emergency-admin@local'
    );
  });

  it('canonicalizes to lowercase', () => {
    expect(canonicalizeBreakGlassUsername('Emergency.Admin_1@LOCAL')).toBe(
      'emergency.admin_1@local'
    );
  });

  it('trims surrounding whitespace', () => {
    expect(canonicalizeBreakGlassUsername('  ops@local  ')).toBe('ops@local');
  });

  it('rejects bare usernames without the reserved suffix', () => {
    expect(canonicalizeBreakGlassUsername('emergency-admin')).toBeNull();
  });

  it.each([
    'ab@local',
    '-lead@local',
    'trail.@local',
    '.dot@local',
    'has space@local',
    'name@@local',
  ])('rejects malformed username "%s"', (input) => {
    expect(canonicalizeBreakGlassUsername(input)).toBeNull();
  });

  it('accepts the maximum local-part length of 64 characters', () => {
    const maxPart = `${'a'.repeat(63)}b`;
    expect(canonicalizeBreakGlassUsername(`${maxPart}@local`)).toBe(
      `${maxPart}@local`
    );
  });

  it('rejects local parts longer than 64 characters', () => {
    expect(canonicalizeBreakGlassUsername(`${'a'.repeat(65)}@local`)).toBeNull();
  });

  it('does not treat other @-domains as valid', () => {
    expect(canonicalizeBreakGlassUsername('admin@sdc.cpp')).toBeNull();
  });

  it('exports the reserved suffix', () => {
    expect(LOCAL_USERNAME_SUFFIX).toBe('@local');
  });
});
