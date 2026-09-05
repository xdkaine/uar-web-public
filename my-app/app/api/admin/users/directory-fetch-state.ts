export const DIRECTORY_RESULT_CAP = 1000;

export type DirectoryFetchState =
  | { state: 'success' }
  | { state: 'result_cap_reached'; resultCap: number }
  | { state: 'size_limit_error'; diagnosticReference?: string }
  | { state: 'query_error'; diagnosticReference?: string };

function getErrorValue(error: unknown, key: 'code' | 'name'): string {
  if (!error || typeof error !== 'object') return '';

  const value = (error as Record<string, unknown>)[key];
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).toLowerCase()
    : '';
}

/**
 * Classify only the directory failure category that operators can safely act
 * on. Raw LDAP diagnostics stay in server-side logs and audit evidence.
 */
export function classifyDirectoryQueryError(error: unknown): Extract<DirectoryFetchState, { state: 'size_limit_error' | 'query_error' }>['state'] {
  const code = getErrorValue(error, 'code');
  const name = getErrorValue(error, 'name');
  const message = error instanceof Error ? error.message.toLowerCase() : '';
  const isSizeLimit = [code, name].some((value) => (
    value === '4'
    || value === '0x4'
    || value === '0x2c'
    || value.includes('sizelimit')
    || value.includes('size_limit')
    || value.includes('administrativelimit')
  )) || /size[\s_-]*limit|administrative[\s_-]*limit/.test(message);

  return isSizeLimit ? 'size_limit_error' : 'query_error';
}
