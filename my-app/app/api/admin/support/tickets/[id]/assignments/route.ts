import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import {
  emitAuditActionLog,
  logAuditAction,
  AuditActions,
  AuditCategories,
  getIpAddress,
  getUserAgent,
  type AuditLogEntry,
} from '@/lib/audit-log';
import { checkRateLimitAsync, isRateLimitUnavailable } from '@/lib/ratelimit';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit, validateEmail, validateStringLength } from '@/lib/validation';
import { searchLDAPUser } from '@/lib/ldap';
import { ldapAccountIsEnabled } from '@/lib/ldap/account-status';

export const dynamic = 'force-dynamic';

interface AssignmentTargetInput {
  targetType?: unknown;
  username?: unknown;
  dn?: unknown;
}

interface AssignBody {
  action?: unknown;
  targets?: unknown;
}

const MAX_TARGETS = 10;
const assignmentResponseSelect = {
  id: true,
  createdAt: true,
  updatedAt: true,
  ticketId: true,
  targetType: true,
  targetUsername: true,
  targetGroupDn: true,
  targetLabel: true,
  isActive: true,
  assignedBy: true,
  assignedAt: true,
} as const;

function ldapAttribute(
  attributes: Array<{ type: string; values: string[] }>,
  name: string
): string {
  return attributes.find((attribute) => attribute.type.toLowerCase() === name.toLowerCase())
    ?.values?.[0]?.trim() ?? '';
}

function normalizeTargets(raw: unknown): { ok: true; targets: Array<{ targetType: 'user' | 'directory_group'; username?: string; dn?: string; label: string; email?: string | null }> } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { ok: false, error: 'targets must be a non-empty array' };
  }
  if (raw.length > MAX_TARGETS) {
    return { ok: false, error: `A maximum of ${MAX_TARGETS} targets per request is allowed` };
  }

  const targets: Array<{ targetType: 'user' | 'directory_group'; username?: string; dn?: string; label: string; email?: string | null }> = [];
  const seen = new Set<string>();

  for (const entry of raw as AssignmentTargetInput[]) {
    if (!entry || typeof entry !== 'object') {
      return { ok: false, error: 'Each target must be an object' };
    }
    const targetType = entry.targetType;
    if (targetType === 'user') {
      if (typeof entry.username !== 'string') {
        return { ok: false, error: 'User targets require a username string' };
      }
      const username = entry.username.trim();
      const usernameValidation = validateStringLength(username, 'Assigned username', 100, 1);
      if (!usernameValidation.valid || /\s/.test(username)) {
        return { ok: false, error: 'Assigned username is invalid' };
      }
      const key = `user:${username.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ targetType: 'user', username, label: username });
    } else if (targetType === 'directory_group') {
      if (typeof entry.dn !== 'string') {
        return { ok: false, error: 'Group targets require a dn string' };
      }
      const dn = entry.dn.trim();
      const dnValidation = validateStringLength(dn, 'Group DN', 400, 1);
      if (!dnValidation.valid) {
        return { ok: false, error: 'Group DN is invalid' };
      }
      const key = `group:${dn.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ targetType: 'directory_group', dn, label: dn });
    } else {
      return { ok: false, error: "targetType must be 'user' or 'directory_group'" };
    }
  }

  if (targets.length === 0) {
    return { ok: false, error: 'targets resolved to no unique entries' };
  }
  return { ok: true, targets };
}

async function authorize(request: NextRequest, permission: 'tickets.assign' | 'tickets.configure') {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return { admin: null, forbidden: response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!actorHasPermission(admin, permission)) {
    return { admin: null, forbidden: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { admin, forbidden: null };
}

// List assignments and history for one ticket
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, forbidden } = await authorize(request, 'tickets.assign');
    if (!admin) return forbidden;

    const resolvedParams = await params;

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: resolvedParams.id },
      select: { id: true },
    });
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const [assignments, history] = await Promise.all([
      prisma.supportTicketAssignment.findMany({
        where: { ticketId: resolvedParams.id },
        select: assignmentResponseSelect,
        orderBy: { assignedAt: 'desc' },
      }),
      prisma.ticketAssignmentHistory.findMany({
        where: { ticketId: resolvedParams.id },
        orderBy: { createdAt: 'desc' },
        take: 100,
      }),
    ]);

    await logAuditAction({
      action: AuditActions.VIEW_TICKET_ASSIGNMENTS,
      category: AuditCategories.SUPPORT,
      username: admin.username,
      targetId: resolvedParams.id,
      targetType: 'SupportTicket',
      details: { activeAssignments: assignments.filter((a) => a.isActive).length },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ assignments, history });
  } catch (error) {
    if (isRateLimitUnavailable(error)) {
      return NextResponse.json(
        { error: 'This service is temporarily unavailable. Please try again later.' },
        { status: 503 }
      );
    }
    console.error('Error fetching ticket assignments:', error);
    return NextResponse.json({ error: 'Failed to fetch ticket assignments' }, { status: 500 });
  }
}

// Assign or unassign owners on a ticket
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, forbidden } = await authorize(request, 'tickets.assign');
    if (!admin) return forbidden;

    const rateLimitResult = await checkRateLimitAsync('ticket-assignment-change', {
      maxRequests: 30,
      windowMs: 60 * 60 * 1000,
      identifier: admin.username,
    });
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Too many assignment changes. Please try again later.' },
        { status: 429 }
      );
    }

    const resolvedParams = await params;
    const body = await parseJsonWithLimit<AssignBody>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const action = body.action;

    if (action !== 'assign' && action !== 'unassign') {
      return NextResponse.json({ error: "action must be 'assign' or 'unassign'" }, { status: 400 });
    }

    const parsed = normalizeTargets(body.targets);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: resolvedParams.id },
      select: { id: true, subject: true, status: true, internalOnly: true },
    });
    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }
    if (ticket.internalOnly) {
      return NextResponse.json(
        { error: 'Internal automation tickets cannot be assigned outside the administrator workspace' },
        { status: 400 }
      );
    }

    // Group targets must be approved assignee groups in the allowlist. Knowing
    // a DN grants nothing (ADR-0007). Direct people are resolved again on the
    // server so a client cannot create a grant for a missing/disabled account
    // or choose the human-readable label stored in history.
    for (const target of parsed.targets) {
      if (target.targetType === 'directory_group' && action === 'assign') {
        const groupDn = target.dn ?? '';
        const group = groupDn
          ? await prisma.allowedTicketSubjectGroup.findUnique({
              where: { dn: groupDn },
              select: { dn: true, name: true, canBeAssignee: true, isActive: true },
            })
          : null;
        if (!group || !group.canBeAssignee || !group.isActive) {
          return NextResponse.json(
            { error: `Group is not an approved ticket assignee group: ${groupDn}` },
            { status: 400 }
          );
        }
        target.label = group.name || groupDn;
      } else if (target.targetType === 'user' && action === 'assign') {
        let directoryUser;
        try {
          directoryUser = await searchLDAPUser(target.username ?? '');
        } catch {
          return NextResponse.json(
            { error: 'Directory lookup is temporarily unavailable. Try again before granting access.' },
            { status: 503 }
          );
        }
        if (!directoryUser || !ldapAccountIsEnabled(directoryUser.attributes)) {
          return NextResponse.json(
            { error: 'That person was not found or their directory account is disabled.' },
            { status: 400 }
          );
        }
        const canonicalUsername = ldapAttribute(directoryUser.attributes, 'sAMAccountName');
        if (!canonicalUsername) {
          return NextResponse.json(
            { error: 'That directory account does not have a usable username.' },
            { status: 400 }
          );
        }
        target.username = canonicalUsername;
        target.label = ldapAttribute(directoryUser.attributes, 'displayName')
          || ldapAttribute(directoryUser.attributes, 'cn')
          || canonicalUsername;
        const directoryEmail = ldapAttribute(directoryUser.attributes, 'mail').toLowerCase();
        target.email = validateEmail(directoryEmail) ? directoryEmail : null;
      }
    }

    // The access grant, immutable history row, and database audit row are one
    // state change. A failure in any of them rolls back every target in this
    // request, so the UI can never report access that lacks its evidence.
    const transactionResult = await prisma.$transaction(async (tx) => {
      const changed: string[] = [];
      const auditEntries: AuditLogEntry[] = [];

      for (const target of parsed.targets) {
        const matchFilter =
          target.targetType === 'user'
            ? { ticketId: resolvedParams.id, targetType: 'user', targetUsername: target.username }
            : { ticketId: resolvedParams.id, targetType: 'directory_group', targetGroupDn: target.dn };

        const existing = await tx.supportTicketAssignment.findFirst({ where: matchFilter });

        if (action === 'unassign' && existing?.targetLabel) {
          target.label = existing.targetLabel;
        }

        if (action === 'assign') {
          if (existing?.isActive) continue;
          if (existing) {
            const result = await tx.supportTicketAssignment.updateMany({
              where: { id: existing.id, isActive: false },
              data: {
                isActive: true,
                targetLabel: target.label,
                targetEmail: target.email ?? null,
                assignedBy: admin.username,
                assignedAt: new Date(),
              },
            });
            if (result.count !== 1) continue;
          } else {
            await tx.supportTicketAssignment.create({
              data: {
                ticketId: resolvedParams.id,
                targetType: target.targetType,
                targetUsername: target.username ?? null,
                targetGroupDn: target.dn ?? null,
                targetLabel: target.label,
                targetEmail: target.email ?? null,
                isActive: true,
                assignedBy: admin.username,
              },
            });
          }
        } else if (existing?.isActive) {
          const result = await tx.supportTicketAssignment.updateMany({
            where: { id: existing.id, isActive: true },
            data: { isActive: false },
          });
          if (result.count !== 1) continue;
        } else {
          continue;
        }

        changed.push(target.label);
        await tx.ticketAssignmentHistory.create({
          data: {
            ticketId: resolvedParams.id,
            action,
            targetType: target.targetType,
            targetLabel: target.label,
            actorUsername: admin.username,
            details: {
              ticketSubject: ticket.subject,
              ticketStatus: ticket.status,
            },
          },
        });

        const auditEntry: AuditLogEntry = {
          action: action === 'assign' ? AuditActions.ASSIGN_TICKET : AuditActions.UNASSIGN_TICKET,
          category: AuditCategories.SUPPORT,
          username: admin.username,
          targetId: resolvedParams.id,
          targetType: 'SupportTicket',
          details: {
            assignmentAction: action,
            assignmentTargetType: target.targetType,
            assignmentTargetLabel: target.label,
          },
          ipAddress: getIpAddress(request),
          userAgent: getUserAgent(request),
        };
        await logAuditAction(auditEntry, tx, { emitOperationalLog: false });
        auditEntries.push(auditEntry);
      }

      return { changedLabels: changed, auditEntries };
    });
    const { changedLabels, auditEntries } = transactionResult;

    // The database audit and access state are committed before an external
    // success event is emitted. Rollbacks therefore cannot leave false
    // success records in the operational log stream.
    for (const auditEntry of auditEntries) {
      emitAuditActionLog(auditEntry);
    }

    if (changedLabels.length > 0) {
      // Notify the current owner set after the state change. Delivery must not
      // affect the assignment result.
      const actorUsername = admin.username;
      import('@/lib/support/routing').then(async ({ resolveTicketNotificationRecipients }) => {
        const recipients = await resolveTicketNotificationRecipients(ticket.id);
        if (recipients.usedQueueFallback || recipients.emails.length === 0) return;
        const { sendTicketAssignedNotificationToAssignees } = await import('@/lib/email');
        await sendTicketAssignedNotificationToAssignees({
          ticketId: ticket.id,
          subject: ticket.subject,
          recipientEmails: recipients.emails,
          targetLabels: changedLabels,
          assignedBy: actorUsername,
          assigned: action === 'assign',
        });
      }).catch((error) => {
        console.error('[Ticket Assignment] Failed to send assignment notification:', error);
      });
    }

    return NextResponse.json({
      message: changedLabels.length > 0
        ? `Assignment ${action === 'assign' ? 'applied to' : 'removed from'}: ${changedLabels.join(', ')}`
        : 'No changes applied',
      changedCount: changedLabels.length,
    });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    if (isRateLimitUnavailable(error)) {
      return NextResponse.json(
        { error: 'This service is temporarily unavailable. Please try again later.' },
        { status: 503 }
      );
    }
    // The partial unique indexes on (ticket, active target) reject concurrent
    // duplicate assigns; surface that as a conflict instead of a 500.
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json(
        { error: 'Assignment was changed concurrently. Reload and try again.' },
        { status: 409 }
      );
    }
    console.error('Error updating ticket assignments:', error);
    return NextResponse.json({ error: 'Failed to update ticket assignments' }, { status: 500 });
  }
}
