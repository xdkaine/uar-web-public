import { afterEach, describe, expect, it } from 'vitest';
import {
  assertCloneModeForDatabaseAttestation,
  assertExternalSideEffectAllowed,
  CloneReadOnlyModeError,
  isProductionCloneReadOnly,
} from './clone-safety';

const originalValue = process.env.PORTAL_CLONE_READ_ONLY;

afterEach(() => {
  if (originalValue === undefined) delete process.env.PORTAL_CLONE_READ_ONLY;
  else process.env.PORTAL_CLONE_READ_ONLY = originalValue;
});

describe('production-clone side-effect guard', () => {
  it.each(['true', 'TRUE'])('enables read-only mode for %s', value => {
    process.env.PORTAL_CLONE_READ_ONLY = value;
    expect(isProductionCloneReadOnly()).toBe(true);
    expect(() => assertExternalSideEffectAllowed('smtp')).toThrow(CloneReadOnlyModeError);
  });

  it('leaves ordinary environments unchanged', () => {
    process.env.PORTAL_CLONE_READ_ONLY = 'false';
    expect(isProductionCloneReadOnly()).toBe(false);
    expect(() => assertExternalSideEffectAllowed('ldap-write')).not.toThrow();
  });

  it('rejects invalid values instead of failing open', () => {
    process.env.PORTAL_CLONE_READ_ONLY = 'treu';
    expect(() => isProductionCloneReadOnly()).toThrow('must be exactly');
  });

  it('requires clone mode for an attested database', () => {
    process.env.PORTAL_CLONE_READ_ONLY = 'false';
    expect(() => assertCloneModeForDatabaseAttestation('receipt')).toThrow(
      'production-clone attestation'
    );
    process.env.PORTAL_CLONE_READ_ONLY = 'true';
    expect(() => assertCloneModeForDatabaseAttestation('receipt')).not.toThrow();
  });
});
