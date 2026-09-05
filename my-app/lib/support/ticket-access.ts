import { prisma } from '@/lib/prisma';
import { searchLDAPUser } from '@/lib/ldap/user-search';
import { isMemberOfAdminGroup } from '@/lib/ldap/admin-groups';
import { ldapAccountIsEnabled } from '@/lib/ldap/account-status';
import {
  resolveAssigneeAccess,
  ASSIGNEE_SNAPSHOT_MAX_AGE_MS,
} from '@/lib/support/assignee-access';

export type TicketAccessRole = 'owner' | 'admin' | 'assignee' | 'group_member';

export interface TicketLike {
  id: string;
  username: string;
  requestedForGroupDn?: string | null;
  internalOnly?: boolean;
}

export interface ViewerAuth {
  username: string;
  isAdmin: boolean;
}

function isFresh(lastSyncedAt: Date | null): boolean {
  if (!lastSyncedAt) return false;
  return Date.now() - lastSyncedAt.getTime() <= ASSIGNEE_SNAPSHOT_MAX_AGE_MS;
}

async function isMemberViaSnapshotOrLive(
  username: string,
  groupDn: string
): Promise<boolean> {
  const [group, snapshot] = await Promise.all([
    prisma.allowedTicketSubjectGroup.findUnique({
      where: { dn: groupDn },
      select: { dn: true, lastSyncedAt: true },
    }),
    prisma.directoryGroupMemberSnapshot.findFirst({
      where: {
        groupDn,
        username: { equals: username, mode: 'insensitive' },
      },
      select: { accountEnabled: true },
    }),
  ]);

  const memberInSnapshot = !!snapshot && snapshot.accountEnabled === true;

  if (memberInSnapshot && isFresh(group?.lastSyncedAt ?? null)) {
    return true;
  }

  if (!group || !isFresh(group.lastSyncedAt)) {
    try {
      const userInfo = await searchLDAPUser(username);
      if (!userInfo) return false;
      if (!ldapAccountIsEnabled(userInfo.attributes)) return false;
      const memberOfAttr = userInfo.attributes.find(
        (attr: { type: string }) => attr.type === 'memberOf'
      );
      const memberOf = memberOfAttr?.values ?? [];
      return isMemberOfAdminGroup(memberOf, JSON.stringify([groupDn]));
    } catch {
      return false;
    }
  }

  return memberInSnapshot;
}

export async function resolveTicketViewAccess(
  ticket: TicketLike,
  auth: ViewerAuth
): Promise<TicketAccessRole | null> {
  if (ticket.internalOnly) return auth.isAdmin ? 'admin' : null;
  if (ticket.username === auth.username) return 'owner';
  if (auth.isAdmin) return 'admin';

  if (ticket.requestedForGroupDn) {
    const viaRequestedFor = await isMemberViaSnapshotOrLive(
      auth.username,
      ticket.requestedForGroupDn
    );
    if (viaRequestedFor) return 'group_member';
  }

  const assignee = await resolveAssigneeAccess(ticket.id, auth.username);
  return assignee.isAssignee ? 'assignee' : null;
}

export async function resolveTicketMutationAccess(
  ticket: TicketLike,
  auth: ViewerAuth
): Promise<TicketAccessRole | null> {
  if (ticket.internalOnly) return auth.isAdmin ? 'admin' : null;
  if (ticket.username === auth.username) return 'owner';
  if (auth.isAdmin) return 'admin';
  const assignee = await resolveAssigneeAccess(ticket.id, auth.username);
  return assignee.isAssignee ? 'assignee' : null;
}
