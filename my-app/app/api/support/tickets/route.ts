import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { requireModuleEnabled } from '@/lib/modules/guards';
import { checkRateLimitAsync, isRateLimitUnavailable } from '@/lib/ratelimit';
import { checkSupportAuth } from '@/lib/support-auth';
import { sendTicketCreationNotifications } from '@/lib/support/ticket-notifications';
import { getFreshAssigneeGroupDnsForUser, getSnapshotMemberGroupDnsForUser, memberOfSnapshotGroups } from '@/lib/support/assignee-access';
import { emitAutomationEvent } from '@/lib/automation/emit';
import { TICKET_CATEGORY_VALUES, isValidTicketCategory } from '@/lib/support/ticket-categories';
import { INPUT_LIMITS, isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit, validateStringLength } from '@/lib/validation';
import { validateTicketRichText } from '@/lib/ticket-content';
import { buildTicketListVisibility } from '@/lib/support/ticket-read-model';
import { serializeSupportTicket } from '@/lib/support/ticket-json';
import { notifyActiveAdministrators } from '@/lib/notifications';

const TICKET_SUMMARY_INCLUDE = {
  responses: {
    orderBy: { createdAt: 'asc' as const },
  },
  _count: { select: { attachments: true } },
};

interface CreateTicketBody {
  subject?: unknown;
  category?: unknown;
  severity?: unknown;
  body?: unknown;
  descriptionHtml?: unknown;
  relatedRequestId?: unknown;
  requestedForGroupDn?: unknown;
  joinGroupDn?: unknown;
}

export async function POST(request: NextRequest) {
  try {
    const { auth, response } = await checkSupportAuth();

    if (!auth) {
      return response || NextResponse.json(
        { error: 'Unauthorized - You must be logged in' },
        { status: 401 }
      );
    }

    const moduleGuard = await requireModuleEnabled('support.tickets');
    if (moduleGuard) return moduleGuard;

    const rateLimitResult = await checkRateLimitAsync('support-ticket-create', {
      maxRequests: 10,
      windowMs: 60 * 60 * 1000,
      identifier: auth.username,
    });

    if (!rateLimitResult.success) {
      return NextResponse.json(
        { 
          error: 'Too many support ticket submissions. Please try again later.',
          retryAfter: Math.ceil((rateLimitResult.reset - Date.now()) / 1000),
        },
        { 
          status: 429,
          headers: {
            'X-RateLimit-Limit': rateLimitResult.limit.toString(),
            'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
            'X-RateLimit-Reset': new Date(rateLimitResult.reset).toISOString(),
            'Retry-After': Math.ceil((rateLimitResult.reset - Date.now()) / 1000).toString(),
          },
        }
      );
    }

    const body = await parseJsonWithLimit<CreateTicketBody>(request, MAX_REQUEST_BODY_SIZE.MEDIUM);
    const { subject, category, severity, body: ticketBody, descriptionHtml, relatedRequestId, requestedForGroupDn, joinGroupDn } = body;
    const normalizedSubject = typeof subject === 'string' ? subject.trim() : '';
    // Rich-text clients send descriptionHtml; the legacy `body` field stays
    // valid for older clients and stored plain text.
    const rawBodySource = [descriptionHtml, ticketBody].find(
      (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0
    );
    const normalizedBody = (rawBodySource ?? '').trim();
    const normalizedCategory = typeof category === 'string' ? category.trim() : '';
    const normalizedSeverity = typeof severity === 'string' ? severity.trim() : '';
    const normalizedRelatedRequestId = typeof relatedRequestId === 'string' ? relatedRequestId.trim() : '';
    const memberGroupDns = await getSnapshotMemberGroupDnsForUser(auth.username);
    // "Requested for" is either self (empty) or an approved group DN. Only DNs
    // present in the active allowlist are accepted, and the filer must be a
    // member of that group per stored snapshots - configuration alone grants
    // nothing, and no live directory lookup happens on this path.
    let normalizedRequestedForGroupDn: string | null = null;
    if (typeof requestedForGroupDn === 'string' && requestedForGroupDn.trim()) {
      normalizedRequestedForGroupDn = requestedForGroupDn.trim();
      if (normalizedRequestedForGroupDn.length > 400) {
        return NextResponse.json({ error: 'Requested-for group is invalid' }, { status: 400 });
      }
      const allowedGroup = await prisma.allowedTicketSubjectGroup.findUnique({
        where: { dn: normalizedRequestedForGroupDn },
        select: { canBeRequestedFor: true, isActive: true },
      });
      if (!allowedGroup || !allowedGroup.canBeRequestedFor || !allowedGroup.isActive) {
        return NextResponse.json(
          { error: 'Requested-for group is not available' },
          { status: 400 }
        );
      }
      if (!memberOfSnapshotGroups(memberGroupDns, normalizedRequestedForGroupDn)) {
        return NextResponse.json(
          { error: 'You can only file a ticket for a group you belong to' },
          { status: 403 }
        );
      }
    }

    // "Join this group" requests follow the same allowlist discipline: only
    // groups flagged canJoinViaTicket in the active allowlist are acceptable.
    let normalizedJoinGroupDn: string | null = null;
    let joinAutoApprove = false;
    if (typeof joinGroupDn === 'string' && joinGroupDn.trim()) {
      normalizedJoinGroupDn = joinGroupDn.trim();
      if (normalizedJoinGroupDn.length > 400) {
        return NextResponse.json({ error: 'Join-group selection is invalid' }, { status: 400 });
      }
      const joinableGroup = await prisma.allowedTicketSubjectGroup.findUnique({
        where: { dn: normalizedJoinGroupDn },
        select: { canJoinViaTicket: true, autoApproveJoin: true, isActive: true },
      });
      if (!joinableGroup || !joinableGroup.canJoinViaTicket || !joinableGroup.isActive) {
        return NextResponse.json(
          { error: 'That group cannot be requested via a ticket' },
          { status: 400 }
        );
      }
      if (memberOfSnapshotGroups(memberGroupDns, normalizedJoinGroupDn)) {
        return NextResponse.json(
          { error: 'You already belong to that group' },
          { status: 400 }
        );
      }
      joinAutoApprove = joinableGroup.autoApproveJoin;
    }

    if (!normalizedSubject || !normalizedBody) {
      return NextResponse.json(
        { error: 'Subject and message body are required' },
        { status: 400 }
      );
    }

    const subjectValidation = validateStringLength(normalizedSubject, 'Subject', INPUT_LIMITS.SUBJECT, 1);
    if (!subjectValidation.valid) {
      return NextResponse.json({ error: subjectValidation.error }, { status: 400 });
    }

    const bodyValidation = validateTicketRichText(normalizedBody, 'Message body');
    if (!bodyValidation.valid) {
      return NextResponse.json({ error: bodyValidation.error }, { status: 400 });
    }
    const sanitizedBody = bodyValidation.sanitized;

    // Validate category if provided
    if (normalizedCategory && !isValidTicketCategory(normalizedCategory)) {
      return NextResponse.json(
        { error: `Category must be one of: ${TICKET_CATEGORY_VALUES.join(', ')}` },
        { status: 400 }
      );
    }

    // Validate severity if provided
    if (normalizedSeverity && !['low', 'medium', 'high', 'critical'].includes(normalizedSeverity)) {
      return NextResponse.json(
        { error: 'Severity must be low, medium, high, or critical' },
        { status: 400 }
      );
    }

    // Validate relatedRequestId if provided
    if (relatedRequestId !== undefined && typeof relatedRequestId !== 'string') {
      return NextResponse.json(
        { error: 'Related access request not found' },
        { status: 400 }
      );
    }

    if (normalizedRelatedRequestId) {
      const requestExists = await prisma.accessRequest.findUnique({
        where: { id: normalizedRelatedRequestId },
        select: {
          id: true,
          ldapUsername: true,
          vpnUsername: true,
          linkedAdUsername: true,
          linkedVpnUsername: true,
        },
      });

      if (!requestExists) {
        return NextResponse.json(
          { error: 'Related access request not found' },
          { status: 400 }
        );
      }

      if (
        !auth.isAdmin &&
        ![
          requestExists.ldapUsername,
          requestExists.vpnUsername,
          requestExists.linkedAdUsername,
          requestExists.linkedVpnUsername,
        ].includes(auth.username)
      ) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Use transaction to create ticket and initial status log
    const ticket = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const newTicket = await tx.supportTicket.create({
        data: {
          subject: normalizedSubject,
          category: normalizedCategory || null,
          severity: normalizedSeverity || null,
          body: sanitizedBody,
          username: auth.username,
          status: 'open',
          relatedRequestId: normalizedRelatedRequestId || null,
          requestedForGroupDn: normalizedRequestedForGroupDn,
          joinGroupDn: normalizedJoinGroupDn,
        },
      });

      await tx.ticketStatusLog.create({
        data: {
          ticketId: newTicket.id,
          oldStatus: null,
          newStatus: 'open',
          changedBy: auth.username,
          isStaff: auth.isAdmin,
        },
      });

      return newTicket;
    });

    // Get user's email if they have an associated access request
    let userEmail: string | null = null;
    if (normalizedRelatedRequestId) {
      const request = await prisma.accessRequest.findUnique({
        where: { id: normalizedRelatedRequestId },
        select: { email: true },
      });
      userEmail = request?.email || null;
    } else {
      // Try to find email from any access request with this username
      const request = await prisma.accessRequest.findFirst({
        where: {
          OR: [
            { ldapUsername: auth.username },
            { vpnUsername: auth.username },
            { linkedAdUsername: auth.username },
            { linkedVpnUsername: auth.username },
          ],
        },
        select: { email: true },
        orderBy: { createdAt: 'desc' },
      });
      userEmail = request?.email || null;
    }

    // Notifications are fire-and-forget: queue event plus creator receipt
    // (ADR-0007). Delivery failures never fail ticket creation.
    sendTicketCreationNotifications({
      ticketId: ticket.id,
      subject: ticket.subject,
      category: ticket.category,
      severity: ticket.severity,
      body: ticket.body,
      username: auth.username,
      creatorEmail: userEmail,
    }).catch((error) => {
      console.error('[Ticket Creation] Unexpected notification failure:', error);
    });

    notifyActiveAdministrators({
      dedupeKey: `ticket-created:${ticket.id}`,
      kind: 'support_ticket',
      title: `New support ticket: ${ticket.subject}`,
      message: `${auth.username} opened a ${ticket.severity ?? 'normal'} severity ticket.`,
      href: `/admin/support/tickets/${ticket.id}`,
      severity: ticket.severity === 'critical' ? 'critical' : 'info',
    }).catch((error) => {
      console.error('[Ticket Creation] Failed to create in-app notifications:', error);
    });

    // Automation rules observe the committed ticket (ADR-0008). Emission is
    // awaited because it only writes local rows; a failure is recorded in the
    // AutomationRun table and logged, and never fails the created ticket.
    try {
      await emitAutomationEvent('ticket_created', ticket.id, {
        ticketId: ticket.id,
        ticketSubject: ticket.subject,
        ticketCategory: ticket.category,
        ticketSeverity: ticket.severity,
        creatorUsername: auth.username,
        joinGroupDn: normalizedJoinGroupDn,
        requestedForGroupDn: normalizedRequestedForGroupDn,
        requestedForSelf: normalizedRequestedForGroupDn === null,
        joinAutoApprove,
      });
    } catch (automationError) {
      console.error('[Ticket Creation] Automation emission failed:', automationError);
    }

    // Visual workflow graphs observe the same event family (ADR-0013).
    try {
      const { emitFlowEvent } = await import('@/lib/flow/engine');
      await emitFlowEvent('ticket_created', `ticket_created:${ticket.id}`, {
        ticketId: ticket.id,
        ticketSubject: ticket.subject,
        category: ticket.category ?? undefined,
        severity: ticket.severity ?? undefined,
        creatorUsername: auth.username,
        username: auth.username,
        joinGroupDn: normalizedJoinGroupDn ?? undefined,
        requestedForGroupDn: normalizedRequestedForGroupDn ?? undefined,
        requestedForSelf: normalizedRequestedForGroupDn === null,
        joinAutoApprove,
      });
    } catch (flowError) {
      console.error('[Ticket Creation] Flow emission failed:', flowError);
    }

    return NextResponse.json(
      {
        message: 'Support ticket created successfully',
        ticketId: ticket.id,
        ticket: serializeSupportTicket(ticket),
      },
      { status: 201 }
    );
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

    console.error('Error creating support ticket:', error);
    return NextResponse.json(
      { error: 'Failed to create support ticket' },
      { status: 500 }
    );
  }
}

// Get all tickets for the logged-in user, plus tickets assigned to groups
// they belong to (fresh snapshots only; ADR-0007)
export async function GET() {
  try {
    const { auth, response } = await checkSupportAuth();

    if (!auth) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const assigneeGroupDns = await getFreshAssigneeGroupDnsForUser(auth.username);
    const visibleTickets = await prisma.supportTicket.findMany({
      where: buildTicketListVisibility(auth.username, assigneeGroupDns),
      orderBy: { updatedAt: 'desc' },
      include: TICKET_SUMMARY_INCLUDE,
    });
    const tickets = visibleTickets.map((ticket) => serializeSupportTicket({
      ...ticket,
      isOwn: ticket.username.toLowerCase() === auth.username.toLowerCase(),
      attachmentCount: ticket._count.attachments,
    }));

    return NextResponse.json({ tickets });
  } catch (error) {
    console.error('Error fetching support tickets:', error);
    return NextResponse.json(
      { error: 'Failed to fetch support tickets' },
      { status: 500 }
    );
  }
}
