import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { validateEmail } from '@/lib/validation';
import { isMemberOfAdminGroup } from '@/lib/ldap/admin-groups';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';

export const dynamic = 'force-dynamic';

// List approved ticket subject/assignee groups and recent sync evidence
export async function GET(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'tickets.configure')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [groups, recentRuns] = await Promise.all([
    prisma.allowedTicketSubjectGroup.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    }),
    prisma.directorySyncRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 5,
      select: {
        id: true,
        status: true,
        triggeredBy: true,
        startedAt: true,
        finishedAt: true,
        groupsProcessed: true,
        membersCaptured: true,
        errors: true,
      },
    }),
  ]);

  return NextResponse.json({
    groups: groups.map((group) => ({
      id: group.id,
      dn: group.dn,
      name: group.name,
      mail: group.mail,
      canBeRequestedFor: group.canBeRequestedFor,
      canJoinViaTicket: group.canJoinViaTicket,
      canBeAssignee: group.canBeAssignee,
      autoApproveJoin: group.autoApproveJoin,
      isActive: group.isActive,
      lastSyncedAt: group.lastSyncedAt,
      lastSyncStatus: group.lastSyncStatus,
      updatedAt: group.updatedAt,
    })),
    recentRuns,
  });
}

interface GroupUpdateBody {
  dn?: unknown;
  name?: unknown;
  mail?: unknown;
  canBeRequestedFor?: unknown;
  canBeAssignee?: unknown;
  canJoinViaTicket?: unknown;
  autoApproveJoin?: unknown;
  isActive?: unknown;
}

// Create or update one approved group
export async function PUT(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'tickets.configure')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await parseJsonWithLimit<GroupUpdateBody>(request, MAX_REQUEST_BODY_SIZE.SMALL);

    if (typeof body.dn !== 'string' || !body.dn.trim()) {
      return NextResponse.json({ error: 'Group DN is required' }, { status: 400 });
    }
    const dn = body.dn.trim();

    // Validate the DN through the hardened parser before persisting.
    try {
      isMemberOfAdminGroup([], JSON.stringify([dn]));
    } catch {
      return NextResponse.json({ error: 'Invalid group distinguished name' }, { status: 400 });
    }

    let name: string | undefined;
    if (body.name !== undefined) {
      if (typeof body.name !== 'string' || body.name.trim().length === 0 || body.name.trim().length > 200) {
        return NextResponse.json({ error: 'name must be a non-empty string of at most 200 characters' }, { status: 400 });
      }
      name = body.name.trim();
    }

    let mail: string | null | undefined;
    if (body.mail !== undefined) {
      if (body.mail === null) {
        mail = null;
      } else if (typeof body.mail === 'string' && body.mail.trim() === '') {
        mail = null;
      } else if (typeof body.mail === 'string' && validateEmail(body.mail.trim().toLowerCase())) {
        mail = body.mail.trim().toLowerCase();
      } else {
        return NextResponse.json({ error: 'mail must be a valid email address or null' }, { status: 400 });
      }
    }

    let flags: Partial<Record<'canBeRequestedFor' | 'canBeAssignee' | 'canJoinViaTicket' | 'autoApproveJoin' | 'isActive', boolean>> | undefined;
    for (const flag of ['canBeRequestedFor', 'canBeAssignee', 'canJoinViaTicket', 'autoApproveJoin', 'isActive'] as const) {
      const value = body[flag];
      if (value !== undefined) {
        if (typeof value !== 'boolean') {
          return NextResponse.json({ error: `${flag} must be a boolean` }, { status: 400 });
        }
        flags = flags ?? {};
        flags[flag] = value;
      }
    }

    const data: Record<string, unknown> = { updatedBy: admin.username };
    if (name !== undefined) data.name = name;
    if (mail !== undefined) data.mail = mail;
    if (flags?.canBeRequestedFor !== undefined) data.canBeRequestedFor = flags.canBeRequestedFor;
    if (flags?.canBeAssignee !== undefined) data.canBeAssignee = flags.canBeAssignee;
    if (flags?.canJoinViaTicket !== undefined) data.canJoinViaTicket = flags.canJoinViaTicket;
    if (flags?.autoApproveJoin !== undefined) data.autoApproveJoin = flags.autoApproveJoin;
    if (flags?.isActive !== undefined) data.isActive = flags.isActive;

    const existing = await prisma.allowedTicketSubjectGroup.findUnique({ where: { dn } });

    const group = existing
      ? await prisma.allowedTicketSubjectGroup.update({ where: { dn }, data })
      : await prisma.allowedTicketSubjectGroup.create({
          data: {
            dn,
            name: name ?? dn,
            mail: mail ?? null,
            canBeRequestedFor: flags?.canBeRequestedFor ?? true,
            canBeAssignee: flags?.canBeAssignee ?? false,
            canJoinViaTicket: flags?.canJoinViaTicket ?? false,
            isActive: flags?.isActive ?? true,
            createdBy: admin.username,
            updatedBy: admin.username,
          },
        });

    await logAuditAction({
      action: AuditActions.MANAGE_TICKET_GROUPS,
      category: AuditCategories.SUPPORT,
      username: admin.username,
      targetId: group.id,
      targetType: 'AllowedTicketSubjectGroup',
      details: {
        operation: existing ? 'update' : 'create',
        groupDn: dn,
        canBeRequestedFor: group.canBeRequestedFor,
        canJoinViaTicket: group.canJoinViaTicket,
        canBeAssignee: group.canBeAssignee,
        isActive: group.isActive,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ group });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Error updating ticket group configuration:', error);
    return NextResponse.json({ error: 'Failed to update ticket group configuration' }, { status: 500 });
  }
}
