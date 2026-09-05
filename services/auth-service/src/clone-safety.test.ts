import { afterEach, describe, expect, it } from 'vitest';
import {
  assertCloneModeForDatabaseAttestation,
  isProductionCloneReadOnly,
} from './clone-safety';

const original = process.env.PORTAL_CLONE_READ_ONLY;

afterEach(() => {
  if (original === undefined) delete process.env.PORTAL_CLONE_READ_ONLY;
  else process.env.PORTAL_CLONE_READ_ONLY = original;
});

describe('production-clone safety', () => {
  it('rejects invalid values', () => {
    process.env.PORTAL_CLONE_READ_ONLY = 'treu';
    expect(() => isProductionCloneReadOnly()).toThrow('must be exactly');
  });

  it('requires clone mode when the database is attested', () => {
    process.env.PORTAL_CLONE_READ_ONLY = 'false';
    expect(() => assertCloneModeForDatabaseAttestation('receipt')).toThrow(
      'production-clone attestation'
    );
    process.env.PORTAL_CLONE_READ_ONLY = 'true';
    expect(() => assertCloneModeForDatabaseAttestation('receipt')).not.toThrow();
  });
});
