import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkSupportAuth } from '@/lib/support-auth';
import { isGroupJoinWorkflowAvailable } from '@/lib/support/group-join-workflow';
import { excludeMemberGroups, getSnapshotMemberGroupDnsForUser } from '@/lib/support/assignee-access';
import { describeGroup } from '@/lib/support/group-display';

export const dynamic = 'force-dynamic';

// Groups a creator may file a ticket "on behalf of", plus groups members may
// ask to join via a ticket. Served entirely from the local allowlist/snapshot
// configuration - never a live LDAP search (ADR-0007).
//
// Filing for a group additionally requires that the requesting user appears
// in that group's stored membership snapshot: being configured is necessary
// but not sufficient. Join requests are intentionally NOT membership-filtered
// - requesters are by definition not yet members. The availability flag
// reports whether an enabled automation rule or published workflow graph can
// actually fulfill a join request, so the form does not advertise dead ends.
export async function GET() {
  try {
    const { auth, response } = await checkSupportAuth();

    if (!auth) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [memberGroupDns, configurableGroups, joinableGroups, groupJoinWorkflowAvailable] =
      await Promise.all([
        getSnapshotMemberGroupDnsForUser(auth.username),
        prisma.allowedTicketSubjectGroup.findMany({
          where: { isActive: true, canBeRequestedFor: true },
          select: { dn: true, name: true },
          orderBy: { name: 'asc' },
        }),
        prisma.allowedTicketSubjectGroup.findMany({
          where: { isActive: true, canJoinViaTicket: true },
          select: { dn: true, name: true },
          orderBy: { name: 'asc' },
        }),
        isGroupJoinWorkflowAvailable().catch(() => false),
      ]);

    const memberSet = new Set(memberGroupDns.map((dn) => dn.toLowerCase()));
    const groups = configurableGroups
      .filter((group) => memberSet.has(group.dn.toLowerCase()))
      .map((group) => ({ ...group, ...describeGroup(group) }));
    const joinable = excludeMemberGroups(joinableGroups, memberGroupDns).map((group) => ({
      ...group,
      ...describeGroup(group),
    }));

    return NextResponse.json({
      groups,
      joinableGroups: joinable,
      groupJoinWorkflowAvailable,
    });
  } catch (error) {
    console.error('Error fetching allowed ticket subject groups:', error);
    return NextResponse.json(
      { error: 'Failed to fetch allowed groups' },
      { status: 500 }
    );
  }
}
