import { Client } from 'ldapts';
import { getConfigValue, getRequiredSecretValue } from '../config/resolver';
import { ldapLogger } from '../logger';
import { isMemberOfAdminGroup } from './admin-groups';
import { ldapAccountIsEnabled } from './account-status';
import { createLDAPClient } from './client';
import {
  withTimeout,
  sanitizeLdapError,
  escapeLDAPFilter,
  escapeLDAPDN,
  LDAP_TIMEOUT,
  parseLDAPDate
} from './utils';

type LDAPUserSearchResult = {
  objectName: string;
  attributes: Array<{ type: string; values: string[] }>;
};

export interface LDAPUserSuggestion {
  username: string;
  displayName: string;
}

const LDAP_USER_LOOKUP_ATTRIBUTES: string[] = [
  'cn',
  'mail',
  'memberOf',
  'sAMAccountName',
  'description',
  'displayName',
  'userAccountControl',
  'adminCount',
  'primaryGroupID',
  'isCriticalSystemObject',
  'objectGUID',
];

function ldapAttributeValue(value: unknown): string {
  return value instanceof Uint8Array ? Buffer.from(value).toString('base64') : String(value);
}

function objectGuidFilterValue(objectGuid: string): string {
  const bytes = Buffer.from(objectGuid, 'base64');
  if (bytes.length === 0 || bytes.toString('base64').replace(/=+$/u, '') !== objectGuid.replace(/=+$/u, '')) {
    throw new Error('Captured directory object identity is not valid binary GUID evidence.');
  }
  return Array.from(bytes, (byte) => `\\${byte.toString(16).padStart(2, '0')}`).join('');
}

function toLDAPUserSearchResult(entry: Record<string, unknown>): LDAPUserSearchResult {
  const attributes = Object.entries(entry).map(([key, value]) => ({
    type: key,
    values: Array.isArray(value) ? value.map(ldapAttributeValue) : [ldapAttributeValue(value)]
  })).filter(attr => attr.type !== 'dn');

  return {
    objectName: entry.dn as string,
    attributes
  };
}

/** Resolve the domain naming context so immutable GUID checks are never limited to a configured OU. */
export async function getLDAPDefaultNamingContext(client: Client): Promise<string> {
  const { searchEntries } = await withTimeout(client.search('', {
    filter: '(objectClass=*)',
    scope: 'base',
    attributes: ['defaultNamingContext'],
    sizeLimit: 1,
  }), LDAP_TIMEOUT);
  const entry = searchEntries[0] as Record<string, unknown> | undefined;
  const key = entry && Object.keys(entry).find((candidate) => candidate.toLowerCase() === 'defaultnamingcontext');
  const raw = key ? entry?.[key] : undefined;
  const value = (Array.isArray(raw) ? raw[0] : raw);
  const namingContext = typeof value === 'string' ? value.trim() : '';
  if (!namingContext) {
    throw new Error('Directory RootDSE did not provide a default naming context for immutable GUID verification.');
  }
  return namingContext;
}

function isNoSuchObjectError(error: unknown): boolean {
  const ldapError = error as { code?: number | string; message?: string };
  const message = ldapError?.message || '';
  return ldapError?.code === 32 ||
    ldapError?.code === '32' ||
    message.includes('NO_OBJECT') ||
    message.toLowerCase().includes('no such object');
}

/**
 * Search for a user by sAMAccountName
 * 
 * @param username - The username to search for
 * @returns User object with DN and attributes, or null if not found
 */
export async function searchLDAPUser(username: string): Promise<{
  objectName: string;
  attributes: Array<{ type: string; values: string[] }>;
} | null> {
  let client: Client | null = null;
  try {
    if (!username) {
      return null;
    }

    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = (await getRequiredSecretValue('ldap.bindPassword'));
    const searchBase = await getConfigValue<string>('ldap.searchBase');

    client = await createLDAPClient();

    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const sanitizedUsername = escapeLDAPFilter(username);

    const opts = {
      filter: `(sAMAccountName=${sanitizedUsername})`,
      scope: 'sub' as const,
      attributes: LDAP_USER_LOOKUP_ATTRIBUTES,
      explicitBufferAttributes: ['objectGUID'],
    };

    const { searchEntries } = await withTimeout(client.search(searchBase, opts), LDAP_TIMEOUT);

    if (searchEntries.length === 0) {
      return null;
    }

    return toLDAPUserSearchResult(searchEntries[0]);
  } catch (err) {
    ldapLogger.error('Error searching for user', sanitizeLdapError(err));
    throw err;
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch (unbindErr) {
        ldapLogger.error('Error unbinding connection', unbindErr);
      }
    }
  }
}

/** Read one directory user by the immutable binary objectGUID evidence stored by lifecycle. */
export async function searchLDAPUserByObjectGuid(objectGuid: string): Promise<LDAPUserSearchResult | null> {
  let client: Client | null = null;
  try {
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = await getRequiredSecretValue('ldap.bindPassword');
    client = await createLDAPClient();
    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);
    const domainSearchBase = await getLDAPDefaultNamingContext(client);
    const { searchEntries } = await withTimeout(client.search(domainSearchBase, {
      filter: `(objectGUID=${objectGuidFilterValue(objectGuid)})`,
      scope: 'sub',
      attributes: LDAP_USER_LOOKUP_ATTRIBUTES,
      explicitBufferAttributes: ['objectGUID'],
      sizeLimit: 2,
    }), LDAP_TIMEOUT);
    if (searchEntries.length === 0) return null;
    if (searchEntries.length > 1) {
      throw new Error('Directory object GUID unexpectedly resolved to more than one user.');
    }
    return toLDAPUserSearchResult(searchEntries[0] as Record<string, unknown>);
  } catch (error) {
    ldapLogger.error('Error searching for user by object GUID', sanitizeLdapError(error));
    throw error;
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch (unbindError) {
        ldapLogger.error('Error unbinding connection', unbindError);
      }
    }
  }
}

/**
 * Bounded administrator autocomplete for enabled AD users. This is deliberately
 * separate from user-facing ticket forms, which use local directory snapshots.
 */
export async function searchLDAPUsers(query: string, requestedLimit = 6): Promise<LDAPUserSuggestion[]> {
  const normalizedQuery = query.trim();
  if (normalizedQuery.length < 3) return [];

  const limit = Math.max(1, Math.min(requestedLimit, 12));
  let client: Client | null = null;
  try {
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = await getRequiredSecretValue('ldap.bindPassword');
    const searchBase = await getConfigValue<string>('ldap.searchBase');

    client = await createLDAPClient();
    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const escapedQuery = escapeLDAPFilter(normalizedQuery);
    const { searchEntries } = await withTimeout(client.search(searchBase, {
      filter: `(&(objectCategory=person)(objectClass=user)(|(sAMAccountName=${escapedQuery}*)(displayName=${escapedQuery}*)(cn=${escapedQuery}*)))`,
      scope: 'sub' as const,
      attributes: ['sAMAccountName', 'displayName', 'cn', 'userAccountControl'],
      sizeLimit: limit * 2,
    }), LDAP_TIMEOUT);

    return searchEntries
      .map((entry) => toLDAPUserSearchResult(entry as Record<string, unknown>))
      .filter((entry) => ldapAccountIsEnabled(entry.attributes))
      .map((entry) => {
        const value = (name: string) => entry.attributes.find(
          (attribute) => attribute.type.toLowerCase() === name.toLowerCase()
        )?.values?.[0]?.trim() ?? '';
        const username = value('sAMAccountName');
        return {
          username,
          displayName: value('displayName') || value('cn') || username,
        };
      })
      .filter((entry) => entry.username.length > 0)
      .slice(0, limit);
  } catch (error) {
    ldapLogger.error('Error searching for users by name', sanitizeLdapError(error));
    throw error;
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch (unbindErr) {
        ldapLogger.error('Error unbinding connection', unbindErr);
      }
    }
  }
}

/**
 * Resolve a bounded set of exact usernames with one bind/search. List and
 * detail views use this instead of opening one LDAP connection per person.
 */
export async function resolveLDAPUserDisplayNames(
  usernames: readonly string[]
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(
    usernames.map((username) => username.trim()).filter(Boolean)
  )).slice(0, 100);
  if (unique.length === 0) return new Map();

  let client: Client | null = null;
  try {
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = await getRequiredSecretValue('ldap.bindPassword');
    const searchBase = await getConfigValue<string>('ldap.searchBase');

    client = await createLDAPClient();
    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const exactFilters = unique
      .map((username) => `(sAMAccountName=${escapeLDAPFilter(username)})`)
      .join('');
    const { searchEntries } = await withTimeout(client.search(searchBase, {
      filter: `(&(objectCategory=person)(objectClass=user)(|${exactFilters}))`,
      scope: 'sub' as const,
      attributes: ['sAMAccountName', 'displayName', 'cn'],
      sizeLimit: unique.length,
    }), LDAP_TIMEOUT);

    const resolved = new Map<string, string>();
    for (const rawEntry of searchEntries) {
      const entry = toLDAPUserSearchResult(rawEntry as Record<string, unknown>);
      const value = (name: string) => entry.attributes.find(
        (attribute) => attribute.type.toLowerCase() === name.toLowerCase()
      )?.values?.[0]?.trim() ?? '';
      const username = value('sAMAccountName');
      if (!username) continue;
      resolved.set(username.toLowerCase(), value('displayName') || value('cn') || username);
    }
    return resolved;
  } catch (error) {
    ldapLogger.error('Error resolving user display names', sanitizeLdapError(error));
    throw error;
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch (unbindErr) {
        ldapLogger.error('Error unbinding connection', unbindErr);
      }
    }
  }
}

/**
 * Search for any LDAP entry that would conflict with provisioning this username.
 * Account creation adds CN=<username> and sets sAMAccountName=<username>, so both
 * identities must be treated as unavailable.
 */
export async function searchLDAPUserForProvisioning(username: string): Promise<LDAPUserSearchResult | null> {
  if (!username) {
    return null;
  }

  const samAccount = await searchLDAPUser(username);
  if (samAccount) {
    return samAccount;
  }

  let client: Client | null = null;
  try {
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = (await getRequiredSecretValue('ldap.bindPassword'));
    const searchBase = await getConfigValue<string>('ldap.searchBase');

    client = await createLDAPClient();
    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const userDN = `CN=${escapeLDAPDN(username)},${searchBase}`;
    const opts = {
      filter: '(objectClass=*)',
      scope: 'base' as const,
      attributes: LDAP_USER_LOOKUP_ATTRIBUTES,
    };

    const { searchEntries } = await withTimeout(client.search(userDN, opts), LDAP_TIMEOUT);

    if (searchEntries.length === 0) {
      return null;
    }

    return toLDAPUserSearchResult(searchEntries[0]);
  } catch (err) {
    if (isNoSuchObjectError(err)) {
      return null;
    }

    ldapLogger.error('Error searching for provisioning user conflict', sanitizeLdapError(err));
    throw err;
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch (unbindErr) {
        ldapLogger.error('Error unbinding connection', unbindErr);
      }
    }
  }
}

/**
 * Check if a user is a domain admin
 * 
 * @param username - The username to check
 * @returns True if user is in any admin group
 */
export async function isUserDomainAdmin(username: string): Promise<boolean> {
  try {
    if (!username) {
      return false;
    }

    const userInfo = await searchLDAPUser(username);

    if (!userInfo || !userInfo.attributes) {
      return false;
    }

    const attributes = Array.isArray(userInfo.attributes) ? userInfo.attributes : [];
    if (!ldapAccountIsEnabled(attributes)) return false;

    const memberOfAttr = attributes.find((attr: { type: string; values: string[] }) => attr.type === 'memberOf');

    if (!memberOfAttr || !memberOfAttr.values || !Array.isArray(memberOfAttr.values)) {
      return false;
    }

    const groups = memberOfAttr.values;

    return isMemberOfAdminGroup(
      groups,
      JSON.stringify(await getConfigValue<string[]>('ldap.adminGroups'))
    );
  } catch (error) {
    ldapLogger.error('Error checking domain admin status', sanitizeLdapError(error));
    return false;
  }
}

/**
 * Get user's email from LDAP by username.
 * Useful for password reset flows.
 * 
 * @param username - The username to look up
 * @returns The user's email or null if not found
 */
export async function getLDAPUserEmail(username: string): Promise<string | null> {
  try {
    const userInfo = await searchLDAPUser(username);

    if (!userInfo || !userInfo.attributes) {
      return null;
    }

    const mailAttr = userInfo.attributes.find(attr => attr.type === 'mail');
    if (mailAttr && mailAttr.values && mailAttr.values.length > 0) {
      return mailAttr.values[0];
    }

    return null;
  } catch (error) {
    ldapLogger.error('Error getting user email', sanitizeLdapError(error));
    return null;
  }
}

/**
 * List all users in the configured OU
 * 
 * @returns Array of user objects with account details
 */
export async function listUsersInOU(): Promise<Array<{
  dn: string;
  objectGuid?: string | null;
  username: string;
  displayName: string;
  email: string;
  description: string;
  accountEnabled: boolean;
  accountExpires: string | null;
  whenCreated: string;
  memberOf: string[];
}>> {
  let client: Client | null = null;
  try {
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = (await getRequiredSecretValue('ldap.bindPassword'));
    const searchBase = await getConfigValue<string>('ldap.searchBase');

    client = await createLDAPClient();
    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const opts = {
      filter: '(objectClass=user)',
      scope: 'sub' as const,
      attributes: [
        'distinguishedName',
        'objectGUID',
        'sAMAccountName',
        'displayName',
        'mail',
        'description',
        'userAccountControl',
        'accountExpires',
        'whenCreated',
        'memberOf'
      ],
      paged: true,
      sizeLimit: 1000,
      explicitBufferAttributes: ['objectGUID'],
    };

    const { searchEntries } = await withTimeout(client.search(searchBase, opts), LDAP_TIMEOUT * 2);

    return searchEntries.map(entry => {
      const uac = parseInt(String(entry.userAccountControl || '512'), 10);
      const accountEnabled = (uac & 2) === 0; // Bit 1 = ACCOUNTDISABLE

      // Parse accountExpires (Windows FILETIME format)
      let accountExpiresDate: string | null = null;
      const accountExpires = entry.accountExpires;
      if (accountExpires && accountExpires !== '0' && accountExpires !== '9223372036854775807') {
        try {
          // Convert Windows FILETIME to Unix timestamp
          const fileTime = BigInt(String(accountExpires));
          const unixMs = Number((fileTime - BigInt('116444736000000000')) / BigInt('10000'));
          if (unixMs > 0 && unixMs < 253402300800000) { // Valid date range
            accountExpiresDate = new Date(unixMs).toISOString();
          }
        } catch {
          // Invalid date format, leave as null
        }
      }

      const memberOf = Array.isArray(entry.memberOf)
        ? entry.memberOf.map(String)
        : entry.memberOf ? [String(entry.memberOf)] : [];

      return {
        dn: String(entry.dn || entry.distinguishedName || ''),
        objectGuid: entry.objectGUID instanceof Uint8Array && entry.objectGUID.length === 16
          ? Buffer.from(entry.objectGUID).toString('base64') : null,
        username: String(entry.sAMAccountName || ''),
        displayName: String(entry.displayName || entry.cn || ''),
        email: String(entry.mail || ''),
        description: String(entry.description || ''),
        accountEnabled,
        accountExpires: accountExpiresDate,
        whenCreated: parseLDAPDate(String(entry.whenCreated || '')) || '',
        memberOf,
      };
    });
  } catch (error) {
    ldapLogger.error('Error listing users in OU', sanitizeLdapError(error));
    throw error;
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch (unbindErr) {
        ldapLogger.error('Error unbinding connection', unbindErr);
      }
    }
  }
}

/**
 * Search for a user by email address
 * 
 * @param email - The email address to search for
 * @returns User object with DN and attributes, or null if not found
 */
export async function searchUserByEmail(email: string): Promise<{
  objectName: string;
  attributes: Array<{ type: string; values: string[] }>;
} | null> {
  let client: Client | null = null;
  try {
    if (!email) {
      return null;
    }

    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = (await getRequiredSecretValue('ldap.bindPassword'));
    const searchBase = await getConfigValue<string>('ldap.searchBase');

    client = await createLDAPClient();

    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const sanitizedEmail = escapeLDAPFilter(email);

    const opts = {
      filter: `(&(objectClass=user)(mail=${sanitizedEmail}))`,
      scope: 'sub' as const,
      attributes: ['cn', 'mail', 'memberOf', 'sAMAccountName', 'description', 'displayName', 'userAccountControl', 'objectGUID'],
    };

    const { searchEntries } = await withTimeout(client.search(searchBase, opts), LDAP_TIMEOUT);

    if (searchEntries.length === 0) {
      return null;
    }

    const entry = searchEntries[0];

    const attributes = Object.entries(entry).map(([key, value]) => ({
      type: key,
      values: Array.isArray(value) ? value.map(String) : [String(value)]
    })).filter(attr => attr.type !== 'dn');

    return {
      objectName: entry.dn as string,
      attributes
    };
  } catch (err) {
    ldapLogger.error('Error searching for user by email', sanitizeLdapError(err));
    throw err;
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch (unbindErr) {
        ldapLogger.error('Error unbinding connection', unbindErr);
      }
    }
  }
}
