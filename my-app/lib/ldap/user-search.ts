import { Client } from 'ldapts';
import { getRequiredEnv } from '../env-validator';
import { ldapLogger } from '../logger';
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

const LDAP_USER_LOOKUP_ATTRIBUTES: string[] = [
  'cn',
  'mail',
  'memberOf',
  'sAMAccountName',
  'description',
  'extensionAttribute15',
  'displayName',
  'userAccountControl',
];

function toLDAPUserSearchResult(entry: Record<string, unknown>): LDAPUserSearchResult {
  const attributes = Object.entries(entry).map(([key, value]) => ({
    type: key,
    values: Array.isArray(value) ? value.map(String) : [String(value)]
  })).filter(attr => attr.type !== 'dn');

  return {
    objectName: entry.dn as string,
    attributes
  };
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

    const ldapUrl = getRequiredEnv('LDAP_URL');
    const bindDN = getRequiredEnv('LDAP_BIND_DN');
    const bindPassword = getRequiredEnv('LDAP_BIND_PASSWORD');
    const searchBase = getRequiredEnv('LDAP_SEARCH_BASE');

    client = createLDAPClient();

    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const sanitizedUsername = escapeLDAPFilter(username);

    const opts = {
      filter: `(sAMAccountName=${sanitizedUsername})`,
      scope: 'sub' as const,
      attributes: LDAP_USER_LOOKUP_ATTRIBUTES,
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
    const bindDN = getRequiredEnv('LDAP_BIND_DN');
    const bindPassword = getRequiredEnv('LDAP_BIND_PASSWORD');
    const searchBase = getRequiredEnv('LDAP_SEARCH_BASE');

    client = createLDAPClient();
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

    const memberOfAttr = attributes.find((attr: { type: string; values: string[] }) => attr.type === 'memberOf');

    if (!memberOfAttr || !memberOfAttr.values || !Array.isArray(memberOfAttr.values)) {
      return false;
    }

    const groups = memberOfAttr.values;

    const ldapAdminGroups = getRequiredEnv('LDAP_ADMIN_GROUPS');
    const adminGroups = ldapAdminGroups.split(',').map(g => g.trim());

    const isAdmin = groups.some((group: string) =>
      group && typeof group === 'string' && adminGroups.some(adminGroup => group.includes(adminGroup))
    );

    return isAdmin;
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
  username: string;
  displayName: string;
  email: string;
  description: string;
  accountEnabled: boolean;
  accountExpires: string | null;
  whenCreated: string;
  memberOf: string[];
  accessRequestId?: string;
}>> {
  let client: Client | null = null;
  try {
    const bindDN = getRequiredEnv('LDAP_BIND_DN');
    const bindPassword = getRequiredEnv('LDAP_BIND_PASSWORD');
    const searchBase = getRequiredEnv('LDAP_SEARCH_BASE');

    client = createLDAPClient();
    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const opts = {
      filter: '(objectClass=user)',
      scope: 'sub' as const,
      attributes: [
        'distinguishedName',
        'sAMAccountName',
        'displayName',
        'mail',
        'description',
        'userAccountControl',
        'accountExpires',
        'whenCreated',
        'memberOf',
        'extensionAttribute15'
      ],
      paged: true,
      sizeLimit: 1000,
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
        username: String(entry.sAMAccountName || ''),
        displayName: String(entry.displayName || entry.cn || ''),
        email: String(entry.mail || ''),
        description: String(entry.description || ''),
        accountEnabled,
        accountExpires: accountExpiresDate,
        whenCreated: parseLDAPDate(String(entry.whenCreated || '')) || '',
        memberOf,
        accessRequestId: entry.extensionAttribute15 ? String(entry.extensionAttribute15) : undefined,
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

    const ldapUrl = getRequiredEnv('LDAP_URL');
    const bindDN = getRequiredEnv('LDAP_BIND_DN');
    const bindPassword = getRequiredEnv('LDAP_BIND_PASSWORD');
    const searchBase = getRequiredEnv('LDAP_SEARCH_BASE');

    client = createLDAPClient();

    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const sanitizedEmail = escapeLDAPFilter(email);

    const opts = {
      filter: `(&(objectClass=user)(mail=${sanitizedEmail}))`,
      scope: 'sub' as const,
      attributes: ['cn', 'mail', 'memberOf', 'sAMAccountName', 'description', 'extensionAttribute15', 'displayName', 'userAccountControl'],
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
