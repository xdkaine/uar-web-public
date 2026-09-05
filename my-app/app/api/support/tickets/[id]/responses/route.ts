import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkSupportAuth, supportAuthHasPermission } from '@/lib/support-auth';
import { requireModuleEnabled } from '@/lib/modules/guards';
import { resolveTicketMutationAccess, resolveTicketViewAccess } from '@/lib/support/ticket-access';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { checkRateLimitAsync, isRateLimitUnavailable } from '@/lib/ratelimit';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';
import { htmlToPlainText, validateTicketRichText } from '@/lib/ticket-content';
import { notifyActiveAdministrators, notifyUser } from '@/lib/notifications';

interface TicketResponseBody {
  message?: unknown;
  replyHtml?: unknown;
  bodyHtml?: unknown;
}

// Get all responses for a ticket
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { auth, response } = await checkSupportAuth();

    if (!auth) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!supportAuthHasPermission(auth, 'tickets.read')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const resolvedParams = await params;

    // Verify the ticket exists and user has access
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const access = await resolveTicketViewAccess(ticket, auth);
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const responses = await prisma.ticketResponse.findMany({
      where: { ticketId: resolvedParams.id },
      orderBy: { createdAt: 'asc' },
    });

    return NextResponse.json({ responses });
  } catch (error) {
    console.error('Error fetching ticket responses:', error);
    return NextResponse.json(
      { error: 'Failed to fetch ticket responses' },
      { status: 500 }
    );
  }
}

// Add a response to a ticket
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { auth, response: authResponse } = await checkSupportAuth();

    if (!auth) {
      return authResponse || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!supportAuthHasPermission(auth, 'tickets.respond')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const moduleGuard = await requireModuleEnabled('support.tickets');
    if (moduleGuard) return moduleGuard;

    const resolvedParams = await params;
    const rateLimitResult = await checkRateLimitAsync('support-ticket-response', {
      maxRequests: 30,
      windowMs: 60 * 60 * 1000,
      identifier: `${auth.username}:${resolvedParams.id}`,
    });

    if (!rateLimitResult.success) {
      return NextResponse.json(
        {
          error: 'Too many support ticket responses. Please try again later.',
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

    const body = await parseJsonWithLimit<TicketResponseBody>(request, MAX_REQUEST_BODY_SIZE.MEDIUM);
    const { message, replyHtml, bodyHtml } = body;
    // Rich-text clients send replyHtml (portal) or bodyHtml (admin); the
    // legacy `message` field stays valid for plain-text callers.
    const rawMessageSource = [replyHtml, bodyHtml, message].find(
      (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0
    );
    const normalizedMessage = (rawMessageSource ?? '').trim();

    if (!normalizedMessage) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    const messageValidation = validateTicketRichText(normalizedMessage, 'Message');
    if (!messageValidation.valid) {
      return NextResponse.json({ error: messageValidation.error }, { status: 400 });
    }
    const sanitizedMessage = messageValidation.sanitized;

    // Verify the ticket exists and user has access
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    const access = await resolveTicketMutationAccess(ticket, auth);
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const isCreator = access === 'owner';

    const idempotencyKey = request.headers.get('x-idempotency-key')?.trim() || null;
    if (idempotencyKey && idempotencyKey.length > 100) {
      return NextResponse.json({ error: 'Idempotency key must be at most 100 characters' }, { status: 400 });
    }
    const matchesRequest = (existing: { author: string; message: string }) =>
      existing.author.toLowerCase() === auth.username.toLowerCase() && existing.message === sanitizedMessage;
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
        if (idempotencyKey) {
          const existing = await tx.ticketResponse.findUnique({
            where: { ticketId_clientRequestId: { ticketId: resolvedParams.id, clientRequestId: idempotencyKey } },
          });
          if (existing) return { response: existing, created: false, conflict: !matchesRequest(existing) };
        }
        const created = await tx.ticketResponse.create({
          data: {
            ticketId: resolvedParams.id,
            message: sanitizedMessage,
            author: auth.username,
            isStaff: auth.isAdmin,
            clientRequestId: idempotencyKey,
          },
        });
        await tx.supportTicket.update({ where: { id: resolvedParams.id }, data: { updatedAt: new Date() } });
        return { response: created, created: true, conflict: false };
      });
    } catch (error) {
      if (!idempotencyKey || (error as { code?: string }).code !== 'P2002') throw error;
      const existing = await prisma.ticketResponse.findUnique({
        where: { ticketId_clientRequestId: { ticketId: resolvedParams.id, clientRequestId: idempotencyKey } },
      });
      if (!existing) throw error;
      result = { response: existing, created: false, conflict: !matchesRequest(existing) };
    }
    if (result.conflict) {
      return NextResponse.json({ error: 'Idempotency key was already used for a different response' }, { status: 409 });
    }
    const response = result.response;

    if (!result.created) {
      return NextResponse.json({ message: 'Response already added', response }, { status: 200 });
    }

    const notification = auth.isAdmin || !isCreator
      ? notifyUser({
          username: ticket.username,
          dedupeKey: `ticket-response:${response.id}`,
          kind: 'support_ticket' as const,
          title: `New response on ${ticket.subject}`,
          message: `${auth.username} responded to your support ticket.`,
          href: `/support/tickets/${ticket.id}`,
        })
      : notifyActiveAdministrators({
          dedupeKey: `ticket-response:${response.id}`,
          kind: 'support_ticket' as const,
          title: `Customer response: ${ticket.subject}`,
          message: `${auth.username} added a response.`,
          href: `/admin/support/tickets/${ticket.id}`,
        });
    notification.catch((error) => {
      console.error('[Ticket Response] Failed to create in-app notifications:', error);
    });

    // Log the ticket response (only if admin)
    if (auth.isAdmin) {
      await logAuditAction({
        action: AuditActions.CREATE_TICKET_RESPONSE,
        category: AuditCategories.SUPPORT,
        username: auth.username,
        targetId: resolvedParams.id,
        targetType: 'SupportTicket',
        details: {
          subject: ticket.subject,
          responsePreview: htmlToPlainText(sanitizedMessage).substring(0, 100),
        },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }

    // Send email notifications
    // Get user's email if they have an associated access request
    let userEmail: string | null = null;
    let userName: string | null = null;
    
    if (ticket.relatedRequestId) {
      const accessRequest = await prisma.accessRequest.findUnique({
        where: { id: ticket.relatedRequestId },
        select: { email: true, name: true },
      });
      userEmail = accessRequest?.email || null;
      userName = accessRequest?.name || null;
    } else {
      // Try to find email from any access request with this username
      const accessRequest = await prisma.accessRequest.findFirst({
        where: {
          OR: [
            { ldapUsername: ticket.username },
            { vpnUsername: ticket.username },
            { linkedAdUsername: ticket.username },
            { linkedVpnUsername: ticket.username },
          ],
        },
        select: { email: true, name: true },
        orderBy: { createdAt: 'desc' },
      });
      userEmail = accessRequest?.email || null;
      userName = accessRequest?.name || null;
    }

    // Send appropriate email notification based on who responded
    if (auth.isAdmin && userEmail) {
      // Staff responded - notify the user
      import('@/lib/email').then(({ sendTicketResponseToUser }) => {
        return sendTicketResponseToUser({
          ticketId: ticket.id,
          subject: ticket.subject,
          userEmail: userEmail!,
          userName: userName || undefined,
          responseMessage: sanitizedMessage,
          staffUsername: auth.username,
        });
      }).catch((error) => {
        console.error('[Ticket Response] Failed to send user notification:', error);
      });
    } else if (!auth.isAdmin && isCreator) {
      // Creator responded - route to active assignees when the ticket is owned;
      // otherwise notify the default queue as before (ADR-0007).
      import('@/lib/support/routing').then(async ({ resolveTicketNotificationRecipients }) => {
        const recipients = await resolveTicketNotificationRecipients(ticket.id);
        if (!recipients.usedQueueFallback && recipients.emails.length > 0) {
          const { sendUserResponseNotificationToAssignees } = await import('@/lib/email');
          return sendUserResponseNotificationToAssignees({
            ticketId: ticket.id,
            subject: ticket.subject,
            recipientEmails: recipients.emails,
            username: auth.username,
            userEmail,
            responseMessage: sanitizedMessage,
          });
        }
        const { sendUserResponseNotificationToAdmin } = await import('@/lib/email');
        return sendUserResponseNotificationToAdmin({
          ticketId: ticket.id,
          subject: ticket.subject,
          username: auth.username,
          userEmail,
          responseMessage: sanitizedMessage,
        });
      }).catch((error) => {
        console.error('[Ticket Response] Failed to send assignee/admin notification:', error);
      });
    } else if (!auth.isAdmin && !isCreator && userEmail) {
      // Assignee-group member responded - notify the creator (ADR-0007).
      import('@/lib/email').then(({ sendTicketResponseToUser }) => {
        return sendTicketResponseToUser({
          ticketId: ticket.id,
          subject: ticket.subject,
          userEmail: userEmail!,
          userName: userName || undefined,
          responseMessage: sanitizedMessage,
          staffUsername: auth.username,
          responderIsStaff: false,
        });
      }).catch((error) => {
        console.error('[Ticket Response] Failed to send creator notification:', error);
      });
    }

    // Visual workflow graphs observe ticket replies (ADR-0013).
    try {
      const { emitFlowEvent } = await import('@/lib/flow/engine');
      await emitFlowEvent('ticket_replied', `ticket_reply:${response.id}`, {
        ticketId: ticket.id,
        ticketSubject: ticket.subject,
        username: auth.username,
        isStaff: auth.isAdmin,
      });
    } catch (flowError) {
      console.error('[Ticket Response] Flow emission failed:', flowError);
    }

    return NextResponse.json(
      {
        message: 'Response added successfully',
        response,
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

    console.error('Error adding ticket response:', error);
    return NextResponse.json(
      { error: 'Failed to add ticket response' },
      { status: 500 }
    );
  }
}
