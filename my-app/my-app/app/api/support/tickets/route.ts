import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimitAsync, isRateLimitUnavailable } from '@/lib/ratelimit';
import { getSessionFromCookies } from '@/lib/session';
import { INPUT_LIMITS, isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit, validateStringLength } from '@/lib/validation';

interface CreateTicketBody {
  subject?: unknown;
  category?: unknown;
  severity?: unknown;
  body?: unknown;
  relatedRequestId?: unknown;
}

async function checkUserAuth() {
  const session = await getSessionFromCookies();

  if (!session) {
    return null;
  }

  return { username: session.username, isAdmin: session.isAdmin };
}

export async function POST(request: NextRequest) {
  try {
    const auth = await checkUserAuth();

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized - You must be logged in' }, { status: 401 });
    }

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
    const { subject, category, severity, body: ticketBody, relatedRequestId } = body;
    const normalizedSubject = typeof subject === 'string' ? subject.trim() : '';
    const normalizedBody = typeof ticketBody === 'string' ? ticketBody.trim() : '';
    const normalizedCategory = typeof category === 'string' ? category.trim() : '';
    const normalizedSeverity = typeof severity === 'string' ? severity.trim() : '';
    const normalizedRelatedRequestId = typeof relatedRequestId === 'string' ? relatedRequestId.trim() : '';

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

    const bodyValidation = validateStringLength(normalizedBody, 'Message body', INPUT_LIMITS.MESSAGE, 1);
    if (!bodyValidation.valid) {
      return NextResponse.json({ error: bodyValidation.error }, { status: 400 });
    }

    // Validate category if provided
    if (normalizedCategory && !['SDC', 'SOC'].includes(normalizedCategory)) {
      return NextResponse.json(
        { error: 'Category must be either SDC or SOC' },
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
    const ticket = await prisma.$transaction(async (tx: any) => {
      const newTicket = await tx.supportTicket.create({
        data: {
          subject: normalizedSubject,
          category: normalizedCategory || null,
          severity: normalizedSeverity || null,
          body: normalizedBody,
          username: auth.username,
          status: 'open',
          relatedRequestId: normalizedRelatedRequestId || null,
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

    // Send notification to admin about new ticket (async, don't wait)
    import('@/lib/email').then(({ sendNewTicketNotificationToAdmin }) => {
      sendNewTicketNotificationToAdmin({
        ticketId: ticket.id,
        subject: ticket.subject,
        category: ticket.category,
        severity: ticket.severity,
        username: auth.username,
        userEmail,
        body: ticket.body,
      }).catch((error) => {
        console.error('[Ticket Creation] Failed to send admin notification:', error);
      });
    });

    return NextResponse.json(
      {
        message: 'Support ticket created successfully',
        ticketId: ticket.id,
        ticket,
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

// Get all tickets for the logged-in user
export async function GET() {
  try {
    const auth = await checkUserAuth();

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tickets = await prisma.supportTicket.findMany({
      where: { username: auth.username },
      orderBy: { createdAt: 'desc' },
      include: {
        responses: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    return NextResponse.json({ tickets });
  } catch (error) {
    console.error('Error fetching support tickets:', error);
    return NextResponse.json(
      { error: 'Failed to fetch support tickets' },
      { status: 500 }
    );
  }
}
