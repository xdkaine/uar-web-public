import type { ConfigEntry } from './config-types';

export interface TestOutcome {
  ok: boolean;
  text: string;
}

export const PRIMARY_URL_KEY = 'ldap.url';
export const FAILOVER_URLS_KEY = 'ldap.failoverUrls';

/**
 * DN-shaped configuration fields get directory autocomplete plus a live
 * "Test path" probe. The value maps to the suggestion type; undefined means
 * test-only (no suggestions), e.g. the service bind DN.
 */
export const DN_FIELDS: Record<string, 'group' | 'ou' | undefined> = {
  'ldap.searchBase': 'ou',
  'ldap.groupSearchBase': 'ou',
  'ldap.bindDn': undefined,
  'ldap.adminGroups': 'group',
  'ldap.kaminoInternalGroup': 'group',
  'ldap.kaminoExternalGroup': 'group',
  'ldap.group2Add': 'group',
};

export function formatValue(entry: ConfigEntry): string {
  if (entry.secret) {
    // Secrets are write-only in the UI: blank means "unchanged".
    return '';
  }
  if (entry.value === null || entry.value === undefined) return '';
  if (Array.isArray(entry.value)) {
    return entry.value.map((v) => String(v)).join(',');
  }
  return String(entry.value);
}

export function parseUrlList(raw: string): string[] {
  return raw
    .split(',')
    .map((url) => url.trim())
    .filter(Boolean);
}
