import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkSupportAuth, supportAuthHasPermission } from '@/lib/support-auth';
import { resolveTicketMutationAccess, resolveTicketViewAccess } from '@/lib/support/ticket-access';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { resolveLDAPUserDisplayNames } from '@/lib/ldap/user-search';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';
import { serializeSupportTicket } from '@/lib/support/ticket-json';

interface UpdateTicketBody {
  status?: unknown;
}

// Helper function to fetch display names for a list of usernames
async function getDisplayNames(usernames: string[]): Promise<Record<string, string>> {
  try {
    const resolved = await resolveLDAPUserDisplayNames(usernames);
    return Object.fromEntries(usernames.map((username) => [
      username,
      resolved.get(username.toLowerCase()) || username,
    ]));
  } catch {
    return Object.fromEntries(usernames.map((username) => [username, username]));
  }
}

// Get a specific ticket
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

    // Users can view their own tickets; admins and assignee-group members can
    // view tickets assigned to them (ADR-0007).
    const access = await resolveTicketViewAccess(ticket, auth);
    if (!access) {
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
      ticket: serializeSupportTicket({
        ...ticket,
        displayName: displayNameMap[ticket.username] || ticket.username,
        statusLogs: enrichedStatusLogs,
        responses: enrichedResponses,
        viewerRole: access,
      })
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
    const { auth, response } = await checkSupportAuth();

    if (!auth) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!supportAuthHasPermission(auth, 'tickets.respond')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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

    // Ticket owner, admin, or assignee-group member can update status
    const access = await resolveTicketMutationAccess(ticket, auth);
    if (!access) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (ticket.status === status) {
      return NextResponse.json({ error: `Ticket is already ${status}` }, { status: 409 });
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

    // Compare-and-set prevents two operators from silently overwriting each
    // other's status transition while preserving an accurate immutable log.
    const updatedTicket = await prisma.$transaction(async (tx) => {
      const claimed = await tx.supportTicket.updateMany({
        where: { id: resolvedParams.id, status: ticket.status, updatedAt: ticket.updatedAt },
        data: updateData,
      });
      if (claimed.count !== 1) return null;
      await tx.ticketStatusLog.create({
        data: {
          ticketId: resolvedParams.id,
          oldStatus: ticket.status,
          newStatus: status,
          changedBy: auth.username,
          isStaff: auth.isAdmin,
        },
      });
      return tx.supportTicket.findUnique({
        where: { id: resolvedParams.id },
        include: {
          responses: { orderBy: { createdAt: 'asc' } },
          statusLogs: { orderBy: { createdAt: 'desc' } },
        },
      });
    });
    if (!updatedTicket) {
      return NextResponse.json({ error: 'Ticket changed while you were editing. Refresh and try again.' }, { status: 409 });
    }

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
      }).catch((auditError) => {
        console.error('[Ticket Status] Status changed but audit logging failed:', auditError);
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

    // Visual workflow graphs observe status changes, including closes (ADR-0013).
    try {
      const { emitFlowEvent } = await import('@/lib/flow/engine');
      await emitFlowEvent('ticket_status_changed', `ticket_status:${ticket.id}:${status}:${updatedTicket.updatedAt}`, {
        ticketId: ticket.id,
        ticketSubject: ticket.subject,
        oldStatus: ticket.status,
        newStatus: status,
        status,
        username: auth.username,
      });
    } catch (flowError) {
      console.error('[Ticket Status Update] Flow emission failed:', flowError);
    }

    return NextResponse.json({ ticket: serializeSupportTicket(updatedTicket) });
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
