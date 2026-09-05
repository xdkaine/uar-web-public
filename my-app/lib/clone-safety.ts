export type ExternalSideEffect = 'smtp' | 'ldap-write';

const CLONE_MODE_ENV = 'PORTAL_CLONE_READ_ONLY';

export class CloneReadOnlyModeError extends Error {
  constructor(effect: ExternalSideEffect) {
    super(`External ${effect} side effects are disabled for this production-clone environment`);
    this.name = 'CloneReadOnlyModeError';
  }
}

export function isProductionCloneReadOnly(): boolean {
  const value = (process.env[CLONE_MODE_ENV] ?? '').trim().toLowerCase();
  if (!value || value === 'false') return false;
  if (value === 'true') return true;
  throw new Error(`${CLONE_MODE_ENV} must be exactly "true" or "false" when set`);
}

export function assertCloneModeForDatabaseAttestation(attestation: string | null): void {
  if (attestation && !isProductionCloneReadOnly()) {
    throw new Error(
      `${CLONE_MODE_ENV}=true is required because this database contains production-clone attestation`
    );
  }
}

export function assertExternalSideEffectAllowed(effect: ExternalSideEffect): void {
  if (isProductionCloneReadOnly()) {
    throw new CloneReadOnlyModeError(effect);
  }
}
