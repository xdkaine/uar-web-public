import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { checkRateLimitAsync, isRateLimitUnavailable } from '@/lib/ratelimit';
import { INPUT_LIMITS, isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit, validateStringLength } from '@/lib/validation';

interface TicketResponseBody {
  message?: unknown;
}

async function checkUserAuth() {
  const session = await getSessionFromCookies();

  if (!session) {
    return null;
  }

  return { username: session.username, isAdmin: session.isAdmin };
}

// Get all responses for a ticket
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await checkUserAuth();

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await params;

    // Verify the ticket exists and user has access
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    if (ticket.username !== auth.username && !auth.isAdmin) {
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
    const auth = await checkUserAuth();

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
    const { message } = body;
    const normalizedMessage = typeof message === 'string' ? message.trim() : '';

    if (!normalizedMessage) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      );
    }

    const messageValidation = validateStringLength(normalizedMessage, 'Message', INPUT_LIMITS.MESSAGE, 1);
    if (!messageValidation.valid) {
      return NextResponse.json({ error: messageValidation.error }, { status: 400 });
    }

    // Verify the ticket exists and user has access
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    if (ticket.username !== auth.username && !auth.isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const response = await prisma.ticketResponse.create({
      data: {
        ticketId: resolvedParams.id,
        message: normalizedMessage,
        author: auth.username,
        isStaff: auth.isAdmin,
      },
    });

    // Update ticket's updatedAt timestamp
    await prisma.supportTicket.update({
      where: { id: resolvedParams.id },
      data: { updatedAt: new Date() },
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
          responsePreview: normalizedMessage.substring(0, 100),
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
        sendTicketResponseToUser({
          ticketId: ticket.id,
          subject: ticket.subject,
          userEmail: userEmail!,
          userName: userName || undefined,
          responseMessage: normalizedMessage,
          staffUsername: auth.username,
        }).catch((error) => {
          console.error('[Ticket Response] Failed to send user notification:', error);
        });
      });
    } else if (!auth.isAdmin) {
      // User responded - notify admin
      import('@/lib/email').then(({ sendUserResponseNotificationToAdmin }) => {
        sendUserResponseNotificationToAdmin({
          ticketId: ticket.id,
          subject: ticket.subject,
          username: auth.username,
          userEmail,
          responseMessage: normalizedMessage,
        }).catch((error) => {
          console.error('[Ticket Response] Failed to send admin notification:', error);
        });
      });
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
