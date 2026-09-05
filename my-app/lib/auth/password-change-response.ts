export interface PasswordChangeResponseBody {
  action?: string;
  message?: string;
  error?: string;
  issues?: string[];
  requiresLogin?: boolean;
}

export type PasswordChangeResponseDecision =
  | { kind: 'requires_login'; message: string }
  | { kind: 'oidc_required' }
  | { kind: 'error'; message: string; issues: string[] }
  | { kind: 'authenticated' };

export function classifyPasswordChangeResponse(
  responseOk: boolean,
  responseStatus: number,
  data: PasswordChangeResponseBody
): PasswordChangeResponseDecision {
  // An external directory mutation may have succeeded even when later portal
  // work failed. Honor that recovery contract before generic HTTP handling so
  // the browser never invites replay of a consumed challenge.
  if (data.requiresLogin) {
    return {
      kind: 'requires_login',
      message: data.message || 'Password updated. Please sign in with your new password.',
    };
  }
  if (!responseOk && responseStatus === 409 && data.action === 'OIDC_REQUIRED') {
    return { kind: 'oidc_required' };
  }
  if (!responseOk) {
    return {
      kind: 'error',
      message: data.error || 'Failed to update password',
      issues: Array.isArray(data.issues) ? data.issues : [],
    };
  }
  return { kind: 'authenticated' };
}
