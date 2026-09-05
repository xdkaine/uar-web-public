import { prisma } from '@/lib/prisma';
import { searchLDAPUser } from '@/lib/ldap/user-search';
import { isMemberOfAdminGroup } from '@/lib/ldap/admin-groups';
import { ldapLogger } from '@/lib/logger';
import { ldapAccountIsEnabled } from '@/lib/ldap/account-status';

/**
 * Assignee access resolution (ADR-0007).
 *
 * Membership in an AD group with an active assignment on a ticket grants
 * view/respond/close on that specific ticket without full admin rights.
 * Fresh snapshots are authoritative; a stale snapshot is never trusted
 * silently - it triggers one live directory membership check, and any LDAP
 * failure fails closed. Direct user assignments match by username exactly.
 */

/** Snapshots older than this are stale and require live verification. */
export const ASSIGNEE_SNAPSHOT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface AssigneeAccess {
  isAssignee: boolean;
  /** Group DNs or usernames through which access was granted. */
  via: string[];
}

function isFresh(lastSyncedAt: Date | null): boolean {
  if (!lastSyncedAt) return false;
  return Date.now() - lastSyncedAt.getTime() <= ASSIGNEE_SNAPSHOT_MAX_AGE_MS;
}

/**
 * Live membership verification used only when a snapshot is stale. Uses the
 * same canonical DN comparison as the domain-admin boundary. One directory
 * lookup covers all candidate groups. Failures fail closed: an unreadable
 * directory never grants assignee access.
 */
async function verifyMembershipLive(
  username: string,
  groupDns: string[]
): Promise<string[]> {
  try {
    const userInfo = await searchLDAPUser(username);
    if (!userInfo) return [];
    if (!ldapAccountIsEnabled(userInfo.attributes)) return [];
    const memberOfAttr = userInfo.attributes.find(
      (attr: { type: string }) => attr.type === 'memberOf'
    );
    const memberOf = memberOfAttr?.values ?? [];
    return groupDns.filter((groupDn) =>
      isMemberOfAdminGroup(memberOf, JSON.stringify([groupDn]))
    );
  } catch (error) {
    ldapLogger.warn('Assignee live membership check failed; denying', { username });
    console.error('[Assignee Access] Live membership check failed:', error);
    return [];
  }
}

export async function resolveAssigneeAccess(
  ticketId: string,
  username: string
): Promise<AssigneeAccess> {
  const assignments = await prisma.supportTicketAssignment.findMany({
    where: { ticketId, isActive: true },
    select: {
      targetType: true,
      targetUsername: true,
      targetGroupDn: true,
    },
  });

  if (assignments.length === 0) {
    return { isAssignee: false, via: [] };
  }

  // Direct user assignment matches the assigned username exactly
  // (case-insensitive; AD names are case-insensitive).
  const normalizedUsername = username.toLowerCase();
  const directHits = assignments.filter(
    (a) => a.targetType === 'user' && a.targetUsername?.toLowerCase() === normalizedUsername
  );
  if (directHits.length > 0) {
    return { isAssignee: true, via: directHits.map((a) => a.targetUsername!) };
  }

  const groupDns = Array.from(
    new Set(assignments.map((a) => a.targetGroupDn).filter((dn): dn is string => !!dn))
  );
  if (groupDns.length === 0) {
    return { isAssignee: false, via: [] };
  }

  const [groups, snapshotRows] = await Promise.all([
    prisma.allowedTicketSubjectGroup.findMany({
      where: { dn: { in: groupDns } },
      select: { dn: true, lastSyncedAt: true },
    }),
    prisma.directoryGroupMemberSnapshot.findMany({
      // Snapshots capture AD-native casing while sessions keep the login name
      // as typed; AD names are case-insensitive, so match insensitively.
      where: { groupDn: { in: groupDns }, username: { equals: username, mode: 'insensitive' } },
      select: { groupDn: true, accountEnabled: true },
    }),
  ]);

  const freshnessByDn = new Map(groups.map((g) => [g.dn, g.lastSyncedAt]));
  const snapshotByDn = new Map(snapshotRows.map((row) => [row.groupDn, row]));
  const freshHits: string[] = [];
  const staleCandidates: string[] = [];

  for (const groupDn of groupDns) {
    const row = snapshotByDn.get(groupDn);
    if (isFresh(freshnessByDn.get(groupDn) ?? null)) {
      // Null/unknown account status fails closed.
      if (row?.accountEnabled === true) freshHits.push(groupDn);
    } else {
      // One live lookup covers stale groups even when the old snapshot did
      // not yet contain this recently-added member.
      staleCandidates.push(groupDn);
    }
  }

  if (freshHits.length > 0) {
    return { isAssignee: true, via: Array.from(new Set(freshHits)) };
  }

  if (staleCandidates.length > 0) {
    const liveHits = await verifyMembershipLive(username, staleCandidates);
    if (liveHits.length > 0) {
      return { isAssignee: true, via: liveHits };
    }
  }

  return { isAssignee: false, via: [] };
}

/**
 * Group DNs the user currently belongs to according to FRESH snapshots -
 * used for list visibility. Stale groups are intentionally omitted here;
 * list views avoid per-user live lookups, while detail/mutation paths still
 * verify stale cases individually.
 */
export async function getFreshAssigneeGroupDnsForUser(username: string): Promise<string[]> {
  const rows = await prisma.directoryGroupMemberSnapshot.findMany({
    where: { username: { equals: username, mode: 'insensitive' } },
    select: { groupDn: true, accountEnabled: true },
  });

  if (rows.length === 0) return [];

  const dns = rows
    .filter((row) => row.accountEnabled === true)
    .map((row) => row.groupDn);
  if (dns.length === 0) return [];

  const groups = await prisma.allowedTicketSubjectGroup.findMany({
    where: { dn: { in: Array.from(new Set(dns)) }, isActive: true },
    select: { dn: true, lastSyncedAt: true },
  });

  return groups.filter((g) => isFresh(g.lastSyncedAt)).map((g) => g.dn);
}

/**
 * Group DNs the user belongs to according to stored membership snapshots -
 * the local read model end-user forms rely on (ADR-0007). Unlike assignee
 * resolution this never performs a live directory lookup and does not apply
 * the freshness gate: filing a ticket for a group you were last synced into
 * is low-risk compared with granting staff access, and a temporarily stalled
 * sync must not silently remove filing options. Disabled accounts are always
 * excluded.
 */
export async function getSnapshotMemberGroupDnsForUser(username: string): Promise<string[]> {
  const rows = await prisma.directoryGroupMemberSnapshot.findMany({
    where: { username: { equals: username, mode: 'insensitive' } },
    select: { groupDn: true, accountEnabled: true },
  });

  return Array.from(
    new Set(
      rows
        .filter((row) => row.accountEnabled === true)
        .map((row) => row.groupDn)
    )
  );
}

/** Case-insensitive DN membership test against a snapshot-derived list. */
export function memberOfSnapshotGroups(groupDns: string[], candidateDn: string): boolean {
  const normalized = candidateDn.trim().toLowerCase();
  if (!normalized) return false;
  return groupDns.some((dn) => typeof dn === 'string' && dn.toLowerCase() === normalized);
}

export function excludeMemberGroups<T extends { dn: string }>(groups: T[], memberGroupDns: string[]): T[] {
  const memberSet = new Set(memberGroupDns.map((dn) => dn.trim().toLowerCase()).filter(Boolean));
  return groups.filter((group) => !memberSet.has(group.dn.trim().toLowerCase()));
}
