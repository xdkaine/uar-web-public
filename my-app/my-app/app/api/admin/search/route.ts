import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { secureJsonResponse, secureErrorResponse } from '@/lib/apiResponse';

/**
 * GET /api/admin/search
 * Global search across all entities (requests, lifecycle actions, VPN accounts, tickets, audit logs)
 */
export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const type = searchParams.get('type') || 'all'; // all, requests, lifecycle, vpn, tickets, audit
    const limit = parseInt(searchParams.get('limit') || '50');

    if (!query || query.length < 2) {
      return secureErrorResponse('Search query must be at least 2 characters', 400);
    }

    const searchLower = query.toLowerCase();
    const results: any = {
      query,
      accessRequests: [],
      lifecycleActions: [],
      vpnAccounts: [],
      supportTickets: [],
      auditLogs: [],
    };

    // Search Access Requests
    if (type === 'all' || type === 'requests') {
      const accessRequests = await prisma.accessRequest.findMany({
        where: {
          OR: [
            { id: { contains: query, mode: 'insensitive' } },
            { name: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
            { ldapUsername: { contains: query, mode: 'insensitive' } },
            { linkedAdUsername: { contains: query, mode: 'insensitive' } },
            { institution: { contains: query, mode: 'insensitive' } },
            { eventReason: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          event: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      results.accessRequests = accessRequests.map((req: any) => ({
        id: req.id,
        type: 'access_request',
        name: req.name,
        email: req.email,
        username: req.ldapUsername || req.linkedAdUsername,
        status: req.status,
        isInternal: req.isInternal,
        event: req.event?.name || req.eventReason,
        createdAt: req.createdAt,
        institution: req.institution,
      }));
    }

    // Search Lifecycle Actions
    if (type === 'all' || type === 'lifecycle') {
      const lifecycleActions = await prisma.accountLifecycleAction.findMany({
        where: {
          OR: [
            { id: { contains: query, mode: 'insensitive' } },
            { targetUsername: { contains: query, mode: 'insensitive' } },
            { reason: { contains: query, mode: 'insensitive' } },
            { notes: { contains: query, mode: 'insensitive' } },
            { relatedRequestId: { contains: query, mode: 'insensitive' } },
            { relatedTicketId: { contains: query, mode: 'insensitive' } },
            { requestedBy: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: limit,
        orderBy: { createdAt: 'desc' },
      });

      results.lifecycleActions = lifecycleActions.map((action: any) => ({
        id: action.id,
        type: 'lifecycle_action',
        actionType: action.actionType,
        targetUsername: action.targetUsername,
        targetAccountType: action.targetAccountType,
        status: action.status,
        reason: action.reason,
        requestedBy: action.requestedBy,
        relatedRequestId: action.relatedRequestId,
        relatedTicketId: action.relatedTicketId,
        createdAt: action.createdAt,
        completedAt: action.completedAt,
      }));
    }

    // Search VPN Accounts
    if (type === 'all' || type === 'vpn') {
      const vpnAccounts = await prisma.vPNAccount.findMany({
        where: {
          OR: [
            { id: { contains: query, mode: 'insensitive' } },
            { username: { contains: query, mode: 'insensitive' } },
            { name: { contains: query, mode: 'insensitive' } },
            { email: { contains: query, mode: 'insensitive' } },
            { revokedReason: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: limit,
        orderBy: { createdAt: 'desc' },
      });

      results.vpnAccounts = vpnAccounts.map((vpn: any) => ({
        id: vpn.id,
        type: 'vpn_account',
        username: vpn.username,
        fullName: vpn.name,
        email: vpn.email,
        status: vpn.status,
        portalType: vpn.portalType,
        createdAt: vpn.createdAt,
        expiresAt: vpn.expiresAt,
        revokedAt: vpn.revokedAt,
        revokedReason: vpn.revokedReason,
      }));
    }

    // Search Support Tickets
    if (type === 'all' || type === 'tickets') {
      const supportTickets = await prisma.supportTicket.findMany({
        where: {
          OR: [
            { id: { contains: query, mode: 'insensitive' } },
            { subject: { contains: query, mode: 'insensitive' } },
            { body: { contains: query, mode: 'insensitive' } },
            { username: { contains: query, mode: 'insensitive' } },
            { relatedRequestId: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: limit,
        orderBy: { createdAt: 'desc' },
      });

      results.supportTickets = supportTickets.map((ticket: any) => ({
        id: ticket.id,
        type: 'support_ticket',
        ticketNumber: ticket.id.substring(0, 8).toUpperCase(), // Use first 8 chars of ID as ticket number
        subject: ticket.subject,
        category: ticket.category,
        priority: ticket.severity || 'normal',
        status: ticket.status,
        requesterName: ticket.username,
        requesterEmail: ticket.username, // Use username as email placeholder
        assignedTo: ticket.closedBy,
        createdAt: ticket.createdAt,
      }));
    }

    // Search Audit Logs (limited fields for performance)
    if (type === 'all' || type === 'audit') {
      const auditLogs = await prisma.auditLog.findMany({
        where: {
          OR: [
            { username: { contains: query, mode: 'insensitive' } },
            { action: { contains: query, mode: 'insensitive' } },
            { targetId: { contains: query, mode: 'insensitive' } },
          ],
        },
        take: limit,
        orderBy: { createdAt: 'desc' },
      });

      results.auditLogs = auditLogs.map((log: any) => ({
        id: log.id,
        type: 'audit_log',
        action: log.action,
        category: log.category,
        username: log.username,
        targetId: log.targetId,
        targetType: log.targetType,
        timestamp: log.createdAt,
        ipAddress: log.ipAddress,
      }));
    }

    // Calculate total results
    const totalResults = 
      results.accessRequests.length +
      results.lifecycleActions.length +
      results.vpnAccounts.length +
      results.supportTickets.length +
      results.auditLogs.length;

    return secureJsonResponse({
      ...results,
      totalResults,
      searchQuery: query,
      searchType: type,
    });
  } catch (error) {
    console.error('Search error:', error);
    return secureErrorResponse(
      error instanceof Error ? error.message : 'Failed to perform search',
      500
    );
  }
}
