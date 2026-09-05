const ACCESS_REQUEST_SENSITIVE_FIELDS = [
  'accountPassword',
  'verificationToken',
  'verificationTokenHash',
] as const;

type AccessRequestSensitiveField = (typeof ACCESS_REQUEST_SENSITIVE_FIELDS)[number];

export type SafeAccessRequestResponse<T extends object> = Omit<T, AccessRequestSensitiveField>;

/**
 * The only supported boundary for serialising AccessRequest records.
 *
 * Prisma mutation results are deliberately accepted here so every caller gets
 * the same deny-list, including fields introduced during a rolling migration.
 * Query-level selects remain preferable for read routes; this serializer is the
 * final response-boundary defence for mutation routes.
 */
export function toSafeAccessRequestResponse<T extends object>(accessRequest: T): SafeAccessRequestResponse<T>;
export function toSafeAccessRequestResponse<T extends object>(accessRequest: T | null): SafeAccessRequestResponse<T> | null;
export function toSafeAccessRequestResponse<T extends object>(
  accessRequest: T | null
): SafeAccessRequestResponse<T> | null {
  if (!accessRequest) return null;
  const response = { ...accessRequest } as T & Partial<Record<AccessRequestSensitiveField, unknown>>;

  for (const field of ACCESS_REQUEST_SENSITIVE_FIELDS) {
    delete response[field];
  }

  return response;
}
