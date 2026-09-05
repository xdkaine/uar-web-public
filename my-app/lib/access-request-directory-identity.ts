type AccessRequestDirectoryIdentity = {
  ldapUsername?: string | null;
  linkedAdUsername?: string | null;
};

function normalizedUsername(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}

/**
 * A request may retain either historical AD alias, but two nonblank aliases
 * must identify the same directory principal before it can authorize AD work.
 */
export function isAccessRequestDirectoryIdentityConsistent(
  request: AccessRequestDirectoryIdentity
): boolean {
  const aliases = new Set([
    normalizedUsername(request.ldapUsername),
    normalizedUsername(request.linkedAdUsername),
  ].filter((value): value is string => Boolean(value)));
  return aliases.size <= 1;
}
