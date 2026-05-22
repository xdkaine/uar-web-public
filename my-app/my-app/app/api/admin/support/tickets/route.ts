import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { searchLDAPUser } from '@/lib/ldap';

// Pagination limits to prevent DoS with large datasets
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

// Helper to get display names from AD for a list of usernames
async function getDisplayNames(usernames: string[]): Promise<Record<string, string>> {
  const displayNameMap: Record<string, string> = {};

  await Promise.all(
    usernames.map(async (username) => {
      try {
        const userInfo = await searchLDAPUser(username);
        if (userInfo) {
          const displayNameAttr = userInfo.attributes.find(a => a.type === 'displayName');
          const cnAttr = userInfo.attributes.find(a => a.type === 'cn');
          displayNameMap[username] = displayNameAttr?.values[0] || cnAttr?.values[0] || username;
        } else {
          displayNameMap[username] = username;
        }
      } catch {
        displayNameMap[username] = username;
      }
    })
  );

  return displayNameMap;
}

// Get all support tickets (admin only)
export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
      },
    });

    // Collect unique usernames to fetch display names
    const usernames = new Set<string>();
    tickets.forEach((ticket: any) => {
      usernames.add(ticket.username);
    });

    // Fetch display names from AD
    const displayNameMap = await getDisplayNames(Array.from(usernames));

    // Enrich tickets with display names
    const enrichedTickets = tickets.map((ticket: any) => ({
      ...ticket,
      displayName: displayNameMap[ticket.username] || ticket.username,
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
