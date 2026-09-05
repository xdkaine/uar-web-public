import { createLDAPClient } from './client';
import { getConfigValue, getRequiredSecretValue } from '../config/resolver';
import { ldapLogger } from '../logger';
import { escapeLDAPFilter, sanitizeLdapError, withTimeout, LDAP_TIMEOUT } from './utils';

type LdapClient = Awaited<ReturnType<typeof createLDAPClient>>;

export interface DirectoryPathProbeResult {
  requestedDn: string;
  found: boolean;
  kind: string | null;
  name: string | null;
  mail: string | null;
  error: string | null;
}

export type DirectorySuggestionType = 'group' | 'ou';

export interface DirectorySuggestion {
  dn: string;
  name: string;
}

function firstAttribute(value: unknown): string | null {
  if (Array.isArray(value)) {
    return value.length > 0 ? String(value[0]) : null;
  }
  return value === undefined || value === null ? null : String(value);
}

/** Maps an entry's objectClass attribute to a small, UI-friendly kind label. */
export function classifyDirectoryObject(objectClassAttr: unknown): string | null {
  const classes = (Array.isArray(objectClassAttr) ? objectClassAttr : objectClassAttr !== undefined && objectClassAttr !== null ? [objectClassAttr] : [])
    .map((value) => String(value).toLowerCase());
  if (classes.length === 0) return null;
  if (classes.includes('group')) return 'group';
  if (classes.includes('organizationalunit')) return 'organizationalUnit';
  if (classes.includes('user') || classes.includes('person') || classes.includes('inetorgperson')) return 'user';
  if (classes.includes('container')) return 'container';
  if (classes.some((value) => value.includes('domaindns'))) return 'domain';
  return 'other';
}

function friendlyProbeError(rawMessage: string): string {
  const message = rawMessage.toLowerCase();
  if (message.includes('no such object') || message.includes('data 525')) {
    return 'No object exists at this path';
  }
  if (
    message.includes('invalid dn') ||
    message.includes('invalid dnsyntax') ||
    message.includes('data 534') ||
    message.includes('decoding')
  ) {
    return 'This is not a syntactically valid distinguished name';
  }
  if (message.includes('timed out')) {
    return 'The directory did not answer in time';
  }
  return `Directory error: ${rawMessage}`;
}

/**
 * Binds with the configured service account and performs a read-only,
 * base-scope lookup of one DN. Never mutates anything; failures are reported
 * as structured results rather than thrown so the UI can render them inline.
 */
export async function probeDirectoryPath(requestedDn: string): Promise<DirectoryPathProbeResult> {
  const dn = requestedDn.trim();
  let client: LdapClient | null = null;
  try {
    client = await createLDAPClient();
    const bindDn = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = await getRequiredSecretValue('ldap.bindPassword');
    await withTimeout(client.bind(bindDn, bindPassword), LDAP_TIMEOUT);

    const { searchEntries } = await client.search(dn, {
      scope: 'base',
      attributes: ['objectClass', 'cn', 'name', 'mail'],
    });

    const entry = searchEntries[0];
    if (!entry) {
      return { requestedDn: dn, found: false, kind: null, name: null, mail: null, error: 'No object exists at this path' };
    }
    return {
      requestedDn: dn,
      found: true,
      kind: classifyDirectoryObject(entry.objectClass),
      name: firstAttribute(entry.cn) ?? firstAttribute(entry.name),
      mail: firstAttribute(entry.mail),
      error: null,
    };
  } catch (error) {
    const sanitized = sanitizeLdapError(error);
    ldapLogger.warn('Directory path probe failed', { requestedDn: dn, message: sanitized.message });
    return {
      requestedDn: dn,
      found: false,
      kind: null,
      name: null,
      mail: null,
      error: friendlyProbeError(sanitized.message),
    };
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch {
        // Connection already closed; nothing further to release.
      }
    }
  }
}

/** Builds the wildcard CN filter for autocomplete searches with safe escaping. */
export function buildSuggestionFilter(type: DirectorySuggestionType, term: string): string {
  const escapedTerm = escapeLDAPFilter(term.trim());
  const objectClass = type === 'group' ? 'group' : 'organizationalUnit';
  return `(&(objectClass=${objectClass})(cn=*${escapedTerm}*))`;
}

async function searchSuggestions(
  containerBase: string,
  filter: string,
  limit: number
): Promise<DirectorySuggestion[]> {
  let client: LdapClient | null = null;
  try {
    client = await createLDAPClient();
    const bindDn = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = await getRequiredSecretValue('ldap.bindPassword');
    await withTimeout(client.bind(bindDn, bindPassword), LDAP_TIMEOUT);

    const { searchEntries } = await withTimeout(
      client.search(containerBase, {
        scope: 'sub',
        filter,
        attributes: ['cn', 'name'],
        sizeLimit: limit * 3,
      }),
      LDAP_TIMEOUT
    );

    return searchEntries
      .map((entry) => ({
        dn: String(entry.dn),
        name: firstAttribute(entry.cn) ?? firstAttribute(entry.name) ?? String(entry.dn),
      }))
      .slice(0, limit);
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch {
        // Connection already closed; nothing further to release.
      }
    }
  }
}

/**
 * Live DN autocomplete against the directory. Groups resolve under the
 * configured group search base (falling back to the main search base); OUs
 * always resolve under the main search base. Read-only.
 */
export async function suggestDirectoryPaths(
  type: DirectorySuggestionType,
  rawTerm: string,
  limit = 8
): Promise<DirectorySuggestion[]> {
  const term = rawTerm.trim().slice(0, 100);
  if (term.length < 2) {
    return [];
  }
  const filter = buildSuggestionFilter(type, term);
  const containerBase =
    type === 'group'
      ? ((await getConfigValue<string>('ldap.groupSearchBase')).trim() ||
        (await getConfigValue<string>('ldap.searchBase')))
      : await getConfigValue<string>('ldap.searchBase');
  if (!containerBase.trim()) {
    return [];
  }
  return searchSuggestions(containerBase, filter, limit);
}
