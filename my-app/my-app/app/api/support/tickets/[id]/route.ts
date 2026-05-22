import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getSessionFromCookies } from '@/lib/session';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { searchLDAPUser } from '@/lib/ldap/user-search';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';

interface UpdateTicketBody {
  status?: unknown;
}

async function checkUserAuth() {
  const session = await getSessionFromCookies();

  if (!session) {
    return null;
  }

  return { username: session.username, isAdmin: session.isAdmin };
}

// Helper function to fetch display names for a list of usernames
async function getDisplayNames(usernames: string[]): Promise<Record<string, string>> {
  const displayNameMap: Record<string, string> = {};

  // Fetch display names in parallel
  await Promise.all(
    usernames.map(async (username) => {
      try {
        const userInfo = await searchLDAPUser(username);
        if (userInfo) {
          // Prefer displayName, then cn, then username
          const displayNameAttr = userInfo.attributes.find(attr => attr.type === 'displayName');
          const cnAttr = userInfo.attributes.find(attr => attr.type === 'cn');
          displayNameMap[username] = displayNameAttr?.values[0] || cnAttr?.values[0] || username;
        } else {
          displayNameMap[username] = username;
        }
      } catch {
        // If lookup fails, use the username as fallback
        displayNameMap[username] = username;
      }
    })
  );

  return displayNameMap;
}

// Get a specific ticket
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

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: resolvedParams.id },
      include: {
        responses: {
          orderBy: { createdAt: 'asc' },
        },
        statusLogs: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    // Users can only view their own tickets unless they're admin
    if (ticket.username !== auth.username && !auth.isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Collect unique usernames from statusLogs and responses for display name lookup, plus the ticket owner
    const usernames = new Set<string>();
    usernames.add(ticket.username);
    ticket.statusLogs.forEach((log: { changedBy: string }) => usernames.add(log.changedBy));
    ticket.responses.forEach((response: { author: string }) => usernames.add(response.author));

    // Fetch display names for all unique usernames
    const displayNameMap = await getDisplayNames(Array.from(usernames));

    // Enrich statusLogs with displayName
    const enrichedStatusLogs = ticket.statusLogs.map((log: { changedBy: string }) => ({
      ...log,
      changedByDisplayName: displayNameMap[log.changedBy] || log.changedBy,
    }));

    // Enrich responses with displayName
    const enrichedResponses = ticket.responses.map((response: { author: string }) => ({
      ...response,
      authorDisplayName: displayNameMap[response.author] || response.author,
    }));

    // Log viewing the ticket (only if admin)
    if (auth.isAdmin) {
      await logAuditAction({
        action: AuditActions.VIEW_TICKET,
        category: AuditCategories.SUPPORT,
        username: auth.username,
        targetId: resolvedParams.id,
        targetType: 'SupportTicket',
        details: {
          subject: ticket.subject,
          status: ticket.status,
          ticketOwner: ticket.username,
        },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }

    return NextResponse.json({
      ticket: {
        ...ticket,
        displayName: displayNameMap[ticket.username] || ticket.username,
        statusLogs: enrichedStatusLogs,
        responses: enrichedResponses,
      }
    });
  } catch (error) {
    console.error('Error fetching support ticket:', error);
    return NextResponse.json(
      { error: 'Failed to fetch support ticket' },
      { status: 500 }
    );
  }
}

// Update ticket (for closing/reopening)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await checkUserAuth();

    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await params;
    const body = await parseJsonWithLimit<UpdateTicketBody>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const { status } = body;

    if (typeof status !== 'string' || !['open', 'in_progress', 'closed'].includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status. Must be open, in_progress, or closed' },
        { status: 400 }
      );
    }

    const ticket = await prisma.supportTicket.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!ticket) {
      return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    }

    // Only ticket owner or admin can update status
    if (ticket.username !== auth.username && !auth.isAdmin) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const updateData: {
      status: string;
      updatedAt: Date;
      closedAt?: Date | null;
      closedBy?: string | null;
    } = {
      status,
      updatedAt: new Date(),
    };

    // Track when ticket is closed
    if (status === 'closed' && ticket.status !== 'closed') {
      updateData.closedAt = new Date();
      updateData.closedBy = auth.username;
    } else if (status !== 'closed') {
      updateData.closedAt = null;
      updateData.closedBy = null;
    }

    // Use transaction to update ticket and create status log
    const [updatedTicket] = await prisma.$transaction([
      prisma.supportTicket.update({
        where: { id: resolvedParams.id },
        data: updateData,
        include: {
          responses: {
            orderBy: { createdAt: 'asc' },
          },
          statusLogs: {
            orderBy: { createdAt: 'desc' },
          },
        },
      }),
      prisma.ticketStatusLog.create({
        data: {
          ticketId: resolvedParams.id,
          oldStatus: ticket.status,
          newStatus: status,
          changedBy: auth.username,
          isStaff: auth.isAdmin,
        },
      }),
    ]);

    // Log the ticket status update (only if admin)
    if (auth.isAdmin) {
      const action = status === 'closed' && ticket.status !== 'closed'
        ? AuditActions.CLOSE_TICKET
        : status !== 'closed' && ticket.status === 'closed'
          ? AuditActions.REOPEN_TICKET
          : AuditActions.UPDATE_TICKET_STATUS;

      await logAuditAction({
        action,
        category: AuditCategories.SUPPORT,
        username: auth.username,
        targetId: resolvedParams.id,
        targetType: 'SupportTicket',
        details: {
          oldStatus: ticket.status,
          newStatus: status,
          subject: ticket.subject,
        },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }

    // Send email notification if status changed and user has email
    if (ticket.status !== status) {
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

      // Send notification if user has email
      if (userEmail) {
        import('@/lib/email').then(({ sendTicketStatusChangeToUser }) => {
          sendTicketStatusChangeToUser({
            ticketId: ticket.id,
            subject: ticket.subject,
            userEmail: userEmail!,
            userName: userName || undefined,
            oldStatus: ticket.status,
            newStatus: status,
            changedBy: auth.username,
          }).catch((error) => {
            console.error('[Ticket Status Update] Failed to send user notification:', error);
          });
        });
      }
    }

    return NextResponse.json({ ticket: updatedTicket });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    console.error('Error updating support ticket:', error);
    return NextResponse.json(
      { error: 'Failed to update support ticket' },
      { status: 500 }
    );
  }
}
