export function isLocalBreakGlassSessionProvider(provider: string | null | undefined): boolean {
  return provider === 'local' || provider === 'local_manual';
}

export function isOidcSessionProvider(provider: string | null | undefined): boolean {
  return provider === 'oidc';
}
