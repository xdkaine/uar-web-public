export interface LoginSelectionMethod {
  id: 'oidc' | 'native_ad' | 'local_break_glass';
}

/** Automatic provider continuation is safe only on a clean login entry. */
export function shouldAutomaticallyStartOidc(
  methods: readonly LoginSelectionMethod[],
  operationalError: string
): boolean {
  return methods.length === 1
    && methods[0]?.id === 'oidc'
    && operationalError.length === 0;
}
