/**
 * Break-glass usernames are namespaced under the reserved "@local" suffix so a
 * local account can never collide with an Active Directory sAMAccountName or
 * UPN (ADR-0009). Usernames are stored and matched fully lowercase end-to-end
 * (provider lookup, gates, session minting, revocation).
 */
export const LOCAL_USERNAME_SUFFIX = '@local';

const LOCAL_PART_PATTERN = /^[a-z0-9][a-z0-9._-]{1,62}[a-z0-9]$/;

/**
 * Canonicalizes operator-supplied break-glass usernames.
 * Returns the stored lowercase form ("name@local") or null when the input is
 * not a well-formed namespaced username.
 */
export function canonicalizeBreakGlassUsername(rawInput: string): string | null {
  const username = rawInput.trim().toLowerCase();
  if (!username.endsWith(LOCAL_USERNAME_SUFFIX)) {
    return null;
  }
  const localPart = username.slice(0, -1 * LOCAL_USERNAME_SUFFIX.length);
  return LOCAL_PART_PATTERN.test(localPart) ? username : null;
}
