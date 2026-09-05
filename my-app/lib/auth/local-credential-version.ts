import { createHash } from 'node:crypto';

export class LocalCredentialChangedError extends Error {
  constructor() {
    super('Local sign-in is no longer valid. Please sign in again.');
    this.name = 'LocalCredentialChangedError';
  }
}

/** Internal comparison proof only; never return it to clients or audit logs. */
export function localCredentialVersion(passwordHash: string): string {
  return createHash('sha256').update(passwordHash).digest('hex');
}
