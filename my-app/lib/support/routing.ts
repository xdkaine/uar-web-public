import { prisma } from '@/lib/prisma';
import { getEmailConfig } from '@/lib/email-config';
import { validateEmail } from '@/lib/validation';

/**
 * Ticket notification recipient resolution (ADR-0007).
 *
 * Active assignments own a ticket's notifications. Group targets prefer their
 * mail-enabled address and otherwise expand members from the latest directory
 * snapshot; user targets resolve through AD-derived data with an access-request
 * email fallback. When nothing resolves, the configured default queue
 * (adminEmail) receives events so notifications never silently vanish.
 */

export interface AssignmentTarget {
  targetType: string;
  targetUsername?: string | null;
  targetGroupDn?: string | null;
  targetEmail?: string | null;
}

export interface ResolvedTicketRecipients {
  emails: string[];
  /** Provenance per resolved email for diagnostics/audit, e.g. "group-mail:<dn>". */
  sources: Record<string, string>;
  usedQueueFallback: boolean;
  activeAssignmentCount: number;
}

interface GroupRecord {
  dn: string;
  name: string;
  mail: string | null;
}

interface MemberRecord {
  username: string;
  email: string | null;
  accountEnabled: boolean | null;
}

function normalizeEmail(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  return normalized && validateEmail(normalized) ? normalized : null;
}

/**
 * Pure expansion logic over prepared inputs so resolution rules can be tested
 * without database or LDAP access.
 */
export function expandRecipientsFromAssignments(
  assignments: AssignmentTarget[],
  groupsByDn: Map<string, GroupRecord>,
  membersByGroupDn: Map<string, MemberRecord[]>,
  userEmailByUsername: Map<string, string | null>,
  queueEmail: string | null
): ResolvedTicketRecipients {
  const emails = new Set<string>();
  const sources: Record<string, string> = {};
  let activeAssignmentCount = 0;

  for (const assignment of assignments) {
    if (assignment.targetType === 'directory_group' && assignment.targetGroupDn) {
      activeAssignmentCount += 1;
      const group = groupsByDn.get(assignment.targetGroupDn);

      // Mail-enabled groups avoid member expansion entirely; large groups stay
      // a single recipient.
      const groupMail = normalizeEmail(group?.mail);
      if (groupMail && !emails.has(groupMail)) {
        emails.add(groupMail);
        sources[groupMail] = `group-mail:${assignment.targetGroupDn}`;
        continue;
      }

      const members = membersByGroupDn.get(assignment.targetGroupDn) || [];
      for (const member of members) {
        // Disabled accounts never receive notifications even if still members.
        if (member.accountEnabled !== true) continue;
        const email = normalizeEmail(member.email);
        if (!email) continue;
        if (!emails.has(email)) {
          emails.add(email);
          sources[email] = `group-member:${assignment.targetGroupDn}`;
        }
      }
    } else if (assignment.targetType === 'user' && assignment.targetUsername) {
      activeAssignmentCount += 1;
      const email = normalizeEmail(userEmailByUsername.get(assignment.targetUsername) ?? null);
      if (email && !emails.has(email)) {
        emails.add(email);
        sources[email] = `user:${assignment.targetUsername}`;
      }
    }
  }

  const usedQueueFallback = emails.size === 0;
  if (usedQueueFallback) {
    const queue = normalizeEmail(queueEmail);
    if (queue) {
      emails.add(queue);
      sources[queue] = 'default-queue';
    }
  }

  return {
    emails: Array.from(emails),
    sources,
    usedQueueFallback,
    activeAssignmentCount,
  };
}

/**
 * Resolve who should receive an event for a ticket right now. Never throws for
 * missing auxiliary data; only a database failure propagates to the caller.
 */
export async function resolveTicketNotificationRecipients(
  ticketId: string
): Promise<ResolvedTicketRecipients> {
  const [assignments, emailConfig] = await Promise.all([
    prisma.supportTicketAssignment.findMany({
      where: { ticketId, isActive: true },
      select: {
        targetType: true,
        targetUsername: true,
        targetGroupDn: true,
        targetEmail: true,
      },
    }),
    getEmailConfig(),
  ]);

  const groupDns = Array.from(
    new Set(assignments.map((a) => a.targetGroupDn).filter((dn): dn is string => !!dn))
  );

  let groupsByDn = new Map<string, GroupRecord>();
  let membersByGroupDn = new Map<string, MemberRecord[]>();

  if (groupDns.length > 0) {
    const [groups, members] = await Promise.all([
      prisma.allowedTicketSubjectGroup.findMany({
        where: { dn: { in: groupDns } },
        select: { dn: true, name: true, mail: true },
      }),
      prisma.directoryGroupMemberSnapshot.findMany({
        where: { groupDn: { in: groupDns } },
        select: {
          groupDn: true,
          username: true,
          email: true,
          accountEnabled: true,
        },
      }),
    ]);

    groupsByDn = new Map(groups.map((g) => [g.dn, g]));
    membersByGroupDn = members.reduce<Map<string, MemberRecord[]>>((acc, member) => {
      const list = acc.get(member.groupDn) || [];
      list.push({
        username: member.username,
        email: member.email,
        accountEnabled: member.accountEnabled,
      });
      acc.set(member.groupDn, list);
      return acc;
    }, new Map());
  }

  const usernames = Array.from(
    new Set(assignments.map((a) => a.targetUsername).filter((u): u is string => !!u))
  );

  const userEmailByUsername = new Map<string, string | null>();
  for (const assignment of assignments) {
    if (assignment.targetType !== 'user' || !assignment.targetUsername) continue;
    const verifiedEmail = normalizeEmail(assignment.targetEmail);
    if (verifiedEmail) userEmailByUsername.set(assignment.targetUsername, verifiedEmail);
  }

  const unresolvedUsernames = usernames.filter((username) => !userEmailByUsername.has(username));
  if (unresolvedUsernames.length > 0) {
    const requests = await prisma.accessRequest.findMany({
      where: {
        OR: unresolvedUsernames.flatMap((username) => [
          { ldapUsername: { equals: username, mode: 'insensitive' as const } },
          { linkedAdUsername: { equals: username, mode: 'insensitive' as const } },
        ]),
      },
      select: { ldapUsername: true, linkedAdUsername: true, email: true },
      orderBy: { createdAt: 'desc' },
    });
    // AD usernames are case-insensitive; snapshots may hold AD-native casing.
    for (const username of unresolvedUsernames) {
      const target = username.toLowerCase();
      const match = requests.find(
        (r) =>
          r.ldapUsername?.toLowerCase() === target ||
          r.linkedAdUsername?.toLowerCase() === target
      );
      userEmailByUsername.set(username, match?.email ?? null);
    }
  }

  return expandRecipientsFromAssignments(
    assignments,
    groupsByDn,
    membersByGroupDn,
    userEmailByUsername,
    emailConfig.adminEmail ?? null
  );
}
