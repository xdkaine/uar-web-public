import { Client, Attribute, Change } from 'ldapts';
import { getConfigValue, getRequiredSecretValue } from '../config/resolver';
import { ldapLogger } from '../logger';
import { createLDAPClient } from './client';
import { 
  withTimeout, 
  sanitizeLdapError,
  LDAP_TIMEOUT 
} from './utils';

type LDAPGroupMember = {
  dn: string;
  username: string;
  displayName: string;
  email: string;
  accountEnabled: boolean | null;
  memberOf: string[];
};

type LDAPSearchClient = Pick<Client, 'search'>;

const MAX_GROUP_ANCESTRY_DEPTH = 20;
const MAX_GROUP_ANCESTRY_NODES = 256;

function toStringArray(value: unknown): string[] {
  if (!value) return [];
  return Array.isArray(value) ? value.map(String) : [String(value)];
}

function ldapIdentityValue(value: unknown): string {
  return value instanceof Uint8Array ? Buffer.from(value).toString('base64') : String(value);
}

export type LDAPGroupIdentity = {
  dn: string;
  objectGuid: string;
};

export async function resolveLDAPGroupIdentityFromClient(
  client: LDAPSearchClient,
  groupDN: string
): Promise<LDAPGroupIdentity> {
  const { searchEntries } = await withTimeout(client.search(groupDN, {
    scope: 'base' as const,
    attributes: ['objectClass', 'objectGUID'],
  }), LDAP_TIMEOUT);
  if (searchEntries.length !== 1 || !hasObjectClass(searchEntries[0] as Record<string, unknown>, 'group')) {
    throw new Error(`Group not found or not uniquely resolvable: ${groupDN}`);
  }
  const entry = searchEntries[0] as Record<string, unknown>;
  if (!entry.objectGUID) {
    throw new Error(`Group has no readable immutable object identity: ${groupDN}`);
  }
  return { dn: String(entry.dn), objectGuid: ldapIdentityValue(entry.objectGUID) };
}

function findMemberAttribute(entry: Record<string, unknown>): { key: string; values: string[] } | null {
  const key = Object.keys(entry).find((entryKey) => entryKey === 'member' || entryKey.toLowerCase().startsWith('member;range='));
  if (!key) return null;
  return { key, values: toStringArray(entry[key]) };
}

function nextMemberRangeStart(rangeKey: string): number | null {
  const match = rangeKey.match(/^member;range=(\d+)-(\d+|\*)$/i);
  if (!match || match[2] === '*') return null;
  return Number(match[2]) + 1;
}

function hasObjectClass(entry: Record<string, unknown>, objectClass: string): boolean {
  return toStringArray(entry.objectClass).some((value) => value.toLowerCase() === objectClass.toLowerCase());
}

/**
 * Resolve every direct and transitive parent of an AD group. The traversal is
 * deliberately bounded and fail-closed so a malformed or unexpectedly large
 * group graph cannot bypass lifecycle protection checks.
 */
export async function resolveLDAPGroupAncestorDNsFromClient(
  client: LDAPSearchClient,
  groupDN: string
): Promise<string[]> {
  const visited = new Set([groupDN.toLowerCase()]);
  const ancestors: string[] = [];
  const queue: Array<{ dn: string; depth: number }> = [{ dn: groupDN, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) break;

    const { searchEntries } = await withTimeout(client.search(current.dn, {
      scope: 'base' as const,
      attributes: ['objectClass', 'memberOf'],
    }), LDAP_TIMEOUT);
    if (searchEntries.length !== 1 || !hasObjectClass(searchEntries[0] as Record<string, unknown>, 'group')) {
      throw new Error(`Group not found or not uniquely resolvable: ${current.dn}`);
    }

    const parentDNs = toStringArray((searchEntries[0] as Record<string, unknown>).memberOf);
    if (parentDNs.length > 0 && current.depth >= MAX_GROUP_ANCESTRY_DEPTH) {
      throw new Error('Group ancestry exceeds the lifecycle safety depth limit');
    }

    for (const parentDN of parentDNs) {
      const normalized = parentDN.toLowerCase();
      if (visited.has(normalized)) continue;
      visited.add(normalized);
      ancestors.push(parentDN);
      if (ancestors.length > MAX_GROUP_ANCESTRY_NODES) {
        throw new Error('Group ancestry exceeds the lifecycle safety size limit');
      }
      queue.push({ dn: parentDN, depth: current.depth + 1 });
    }
  }

  return ancestors;
}

export async function getLDAPGroupAncestorDNs(groupDN: string): Promise<string[]> {
  let client: Client | null = null;
  try {
    client = await createLDAPClient();
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = await getRequiredSecretValue('ldap.bindPassword');
    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);
    return await resolveLDAPGroupAncestorDNsFromClient(client, groupDN);
  } catch (err) {
    ldapLogger.error('Error resolving LDAP group ancestry', sanitizeLdapError(err as Record<string, unknown>));
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

export async function getLDAPGroupIdentity(groupDN: string): Promise<LDAPGroupIdentity> {
  let client: Client | null = null;
  try {
    client = await createLDAPClient();
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = await getRequiredSecretValue('ldap.bindPassword');
    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);
    return await resolveLDAPGroupIdentityFromClient(client, groupDN);
  } catch (err) {
    ldapLogger.error('Error resolving LDAP group identity', sanitizeLdapError(err as Record<string, unknown>));
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

async function readAllMemberDNs(client: LDAPSearchClient, groupDN: string): Promise<string[]> {
  const memberDNs: string[] = [];
  let rangeStart = 0;

  while (true) {
    const attribute = rangeStart === 0 ? 'member' : `member;range=${rangeStart}-*`;
    const { searchEntries } = await withTimeout(client.search(groupDN, {
      scope: 'base' as const,
      attributes: [attribute],
    }), LDAP_TIMEOUT);

    if (searchEntries.length === 0) {
      throw new Error(`Group not found: ${groupDN}`);
    }

    const memberAttribute = findMemberAttribute(searchEntries[0] as Record<string, unknown>);
    if (!memberAttribute) break;

    memberDNs.push(...memberAttribute.values);
    const nextStart = nextMemberRangeStart(memberAttribute.key);
    if (nextStart === null || nextStart <= rangeStart) break;
    rangeStart = nextStart;
  }

  return memberDNs;
}

export async function resolveLDAPGroupMembersFromClient(
  client: LDAPSearchClient,
  groupDN: string,
  visitedGroupDNs = new Set<string>(),
  visitedUserDNs = new Set<string>()
): Promise<LDAPGroupMember[]> {
  const normalizedGroupDN = groupDN.toLowerCase();
  if (visitedGroupDNs.has(normalizedGroupDN)) {
    return [];
  }
  visitedGroupDNs.add(normalizedGroupDN);

  const memberDNs = await readAllMemberDNs(client, groupDN);
  const resolvedMembers: LDAPGroupMember[] = [];

  for (const memberDNValue of memberDNs) {
    const memberDN = String(memberDNValue);
    const normalizedMemberDN = memberDN.toLowerCase();
    try {
      const memberOpts = {
        scope: 'base' as const,
        attributes: ['objectClass', 'sAMAccountName', 'displayName', 'cn', 'mail', 'userAccountControl', 'memberOf'],
      };
      const { searchEntries: memberEntries } = await withTimeout(client.search(memberDN, memberOpts), LDAP_TIMEOUT);

      if (memberEntries.length === 0) {
        continue;
      }

      const entry = memberEntries[0] as Record<string, unknown>;
      if (hasObjectClass(entry, 'group')) {
        resolvedMembers.push(...await resolveLDAPGroupMembersFromClient(client, memberDN, visitedGroupDNs, visitedUserDNs));
        continue;
      }

      if (visitedUserDNs.has(normalizedMemberDN)) {
        continue;
      }
      visitedUserDNs.add(normalizedMemberDN);

      const uac = entry.userAccountControl ? parseInt(String(entry.userAccountControl), 10) : NaN;
      resolvedMembers.push({
        dn: String(entry.dn),
        username: String(entry.sAMAccountName || entry.cn),
        displayName: String(entry.displayName || entry.cn),
        email: String(entry.mail || ''),
        accountEnabled: Number.isNaN(uac) ? null : (uac & 2) === 0,
        memberOf: toStringArray(entry.memberOf),
      });
    } catch (error) {
      ldapLogger.warn(`Failed to resolve member ${memberDN}`, error as Record<string, unknown>);
    }
  }

  return resolvedMembers;
}

/**
 * Search for AD groups matching a query string
 */
export async function searchLDAPGroups(query: string): Promise<Array<{
  dn: string;
  name: string;
  description: string;
  objectGuid: string;
}>> {
  let client: Client | null = null;
  try {
    client = await createLDAPClient();
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = (await getRequiredSecretValue('ldap.bindPassword'));
    const groupSearchBase = await getConfigValue<string>('ldap.groupSearchBase');

    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    // Sanitize query to prevent injection
    const sanitizedQuery = query.replace(/[()*\\]/g, '');

    const filter = sanitizedQuery
      ? `(&(objectClass=group)(cn=*${sanitizedQuery}*))`
      : '(&(objectClass=group)(cn=*))';

    const opts = {
      filter,
      scope: 'sub' as const,
      sizeLimit: 1000,
      attributes: ['cn', 'description', 'distinguishedName', 'objectGUID'],
    };

    const { searchEntries } = await withTimeout(client.search(groupSearchBase, opts), LDAP_TIMEOUT);

    return searchEntries.map((entry) => {
      const group = entry as Record<string, unknown>;
      return {
        dn: String(group.dn),
        name: String(group.cn),
        description: String(group.description || ''),
        objectGuid: group.objectGUID ? ldapIdentityValue(group.objectGUID) : '',
      };
    });
  } catch (err) {
    ldapLogger.error('Error searching LDAP groups', sanitizeLdapError(err as Record<string, unknown>));
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
 * Get all members of a specific AD group
 */
export async function getLDAPGroupMembers(groupDN: string): Promise<Array<{
  dn: string;
  username: string;
  displayName: string;
  email: string;
  accountEnabled: boolean | null;
  memberOf: string[];
}>> {
  let client: Client | null = null;
  try {
    client = await createLDAPClient();
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = (await getRequiredSecretValue('ldap.bindPassword'));

    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    return await resolveLDAPGroupMembersFromClient(client, groupDN);
  } catch (err) {
    ldapLogger.error('Error getting LDAP group members', sanitizeLdapError(err as Record<string, unknown>));
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
 * Add a user to an AD group
 */
export async function addLDAPGroupMember(groupDN: string, userDN: string): Promise<boolean> {
  let client: Client | null = null;
  try {
    client = await createLDAPClient();
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = (await getRequiredSecretValue('ldap.bindPassword'));

    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const change = new Change({
      operation: 'add',
      modification: new Attribute({
        type: 'member',
        values: [userDN]
      })
    });

    await withTimeout(client.modify(groupDN, change), LDAP_TIMEOUT);

    ldapLogger.info('Added user to group', { groupDN, userDN });
    return true;
  } catch (err: unknown) {
    const ldapError = err as { code?: number; message?: string };
    // Check if error is "already exists" (code 68)
    if (ldapError.code === 68 || (ldapError.message && ldapError.message.includes('already exists'))) {
      ldapLogger.info('User already in group', { groupDN, userDN });
      return true;
    }

    ldapLogger.error('Error adding user to group', sanitizeLdapError(err as Record<string, unknown>));
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
 * Remove a user from an AD group
 */
export async function removeLDAPGroupMember(groupDN: string, userDN: string): Promise<boolean> {
  let client: Client | null = null;
  try {
    client = await createLDAPClient();
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = (await getRequiredSecretValue('ldap.bindPassword'));

    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const change = new Change({
      operation: 'delete',
      modification: new Attribute({
        type: 'member',
        values: [userDN]
      })
    });

    await withTimeout(client.modify(groupDN, change), LDAP_TIMEOUT);

    ldapLogger.info('Removed user from group', { groupDN, userDN });
    return true;
  } catch (err: unknown) {
    const ldapError = err as { code?: number; message?: string };
    // Check if error is "no such attribute" (user not in group)
    if (ldapError.code === 53 || ldapError.code === 16 || (ldapError.message && ldapError.message.includes('unwilling to perform'))) {
      ldapLogger.warn('User not in group or cannot remove', { groupDN, userDN, error: ldapError.message });
      return true;
    }

    ldapLogger.error('Error removing user from group', sanitizeLdapError(err as Record<string, unknown>));
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
