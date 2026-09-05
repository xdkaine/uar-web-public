import { getPortalSignInPolicy, getPortalSignInReadiness } from '@/lib/auth/sign-in-policy';

export type EffectiveAuthMode = 'oidc' | 'native' | 'local';

export const PERSISTABLE_AUTH_MODES = ['oidc', 'native', 'local'] as const;
export type PersistableAuthMode = (typeof PERSISTABLE_AUTH_MODES)[number];

export type AuthModeWriteResult =
  | { ok: true; value: PersistableAuthMode | null }
  | { ok: false; error: string };

/**
 * Compatibility view for callers that still expect one primary auth mode.
 * The unified sign-in policy owns resolution, including its legacy fallback.
 */
export async function getEffectiveAuthMode(): Promise<EffectiveAuthMode> {
  const resolved = await getPortalSignInPolicy();
  const first = resolved.methods.find((method) => method.enabled && method.ready)?.id;
  if (first === 'oidc') return 'oidc';
  if (first === 'local_break_glass') return 'local';
  if (first === 'native_ad') return 'native';
  throw new Error('No enabled portal sign-in method is ready');
}

/**
 * Gate persisted sign-in mode writes (ADR-0014): reject values outside the
 * enum and combinations that would advertise a dead sign-in flow. This legacy
 * API uses the same complete readiness checks as the authoritative policy.
 */
export async function validateAuthModeWrite(value: unknown): Promise<AuthModeWriteResult> {
  if (value === null) {
    return { ok: true, value: null };
  }
  if (
    typeof value !== 'string' ||
    !(PERSISTABLE_AUTH_MODES as readonly string[]).includes(value)
  ) {
    return {
      ok: false,
      error: 'authMode must be one of: oidc, native, local (or null to clear the override)',
    };
  }

  const readiness = await getPortalSignInReadiness();
  const method = value === 'oidc'
    ? readiness.oidc
    : value === 'local'
      ? readiness.local_break_glass
      : readiness.native_ad;
  if (!method.ready) {
    return {
      ok: false,
      error: `Cannot enable ${value} sign-in: ${method.issue ?? 'the method is not ready'}`,
    };
  }
  return { ok: true, value: value as PersistableAuthMode };
}
