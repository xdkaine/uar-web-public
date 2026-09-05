import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { resolveLDAPUserDisplayNames } from '@/lib/ldap';
import { serializeSupportTicket } from '@/lib/support/ticket-json';

// Pagination limits to prevent DoS with large datasets
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// Helper to get display names from AD for a list of usernames
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

// Get all support tickets (admin only)
export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'tickets.read')) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Parse pagination parameters
    const searchParams = request.nextUrl.searchParams;
    const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
    const requestedLimit = parseInt(searchParams.get('limit') || String(DEFAULT_PAGE_SIZE), 10);
    const limit = Math.min(Math.max(1, requestedLimit), MAX_PAGE_SIZE);
    const skip = (page - 1) * limit;

    // Get total count and status counts for pagination metadata
    const [total, openCount] = await Promise.all([
      prisma.supportTicket.count(),
      prisma.supportTicket.count({ where: { status: 'open' } }),
    ]);

    const tickets = await prisma.supportTicket.findMany({
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
      include: {
        responses: {
          orderBy: { createdAt: 'asc' },
        },
        statusLogs: {
          orderBy: { createdAt: 'desc' },
        },
        assignments: {
          where: { isActive: true },
          select: {
            targetType: true,
            targetUsername: true,
            targetGroupDn: true,
            targetLabel: true,
          },
          orderBy: { assignedAt: 'desc' },
        },
        _count: { select: { attachments: true } },
      },
    });

    // Collect unique usernames to fetch display names
    const usernames = new Set<string>();
    tickets.forEach((ticket) => {
      usernames.add(ticket.username);
    });

    // Fetch display names from AD
    const displayNameMap = await getDisplayNames(Array.from(usernames));

    // Enrich tickets with display names
    const enrichedTickets = tickets.map((ticket) => serializeSupportTicket({
      ...ticket,
      displayName: displayNameMap[ticket.username] || ticket.username,
      assignees: ticket.assignments.map((assignment) => assignment.targetLabel),
      attachmentCount: ticket._count.attachments,
    }));

    // Log audit action
    await logAuditAction({
      action: AuditActions.VIEW_TICKETS_LIST,
      category: AuditCategories.SUPPORT,
      username: admin.username,
      details: {
        totalTickets: total,
        openTickets: openCount,
        page,
        limit,
        returnedCount: tickets.length,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({
      tickets: enrichedTickets,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
        openTickets: openCount,
      },
    });
  } catch (error) {
    console.error('Error fetching all support tickets:', error);
    return NextResponse.json(
      { error: 'Failed to fetch support tickets' },
      { status: 500 }
    );
  }
}
