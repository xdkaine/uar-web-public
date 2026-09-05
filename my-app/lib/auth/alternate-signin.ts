export type OidcAlternateSignInPolicy = 'off' | 'native' | 'local' | 'native_and_local';

export type OidcSignInMethod = 'oidc' | 'native_ad' | 'local_break_glass';

export function getOidcAlternateSignInPolicy(): OidcAlternateSignInPolicy {
  const value = process.env.AUTH_OIDC_ALTERNATE_SIGNIN;
  return value === 'native' || value === 'local' || value === 'native_and_local'
    ? value
    : 'off';
}

export function isOidcAlternateSignInMethodAllowed(
  method: OidcSignInMethod
): boolean {
  if (method === 'oidc') return true;
  const policy = getOidcAlternateSignInPolicy();
  if (method === 'native_ad') {
    return policy === 'native' || policy === 'native_and_local';
  }
  return policy === 'local' || policy === 'native_and_local';
}

export function getOidcSignInMethods(): OidcSignInMethod[] {
  return (['oidc', 'native_ad', 'local_break_glass'] as const).filter(
    isOidcAlternateSignInMethodAllowed
  );
}
