import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { prisma } from '@/lib/prisma';
import { secureJsonResponse, secureErrorResponse } from '@/lib/apiResponse';
import {
  ADMIN_SEARCH_SCOPE_PERMISSIONS,
  getAvailableAdminSearchTypes,
  isAdminSearchType,
} from '@/lib/rbac/search-access';
import { resolveRequestReviews } from '@/lib/workflow/request-review';

const MIN_QUERY_LENGTH = 2;
const MAX_LIMIT = 100;

/**
 * GET /api/admin/search
 * Global search across all entities (requests, lifecycle actions, VPN accounts, tickets, audit logs).
 * All entity queries run in parallel; each category is capped independently.
 */
export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!actorHasPermission(admin, 'admin.search')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const query = (searchParams.get('q') || '').trim();
    const requestedType = searchParams.get('type') || 'all';
    const parsedLimit = parseInt(searchParams.get('limit') || '50', 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), MAX_LIMIT) : 50;

    if (!query || query.length < MIN_QUERY_LENGTH) {
      return secureErrorResponse(`Search query must be at least ${MIN_QUERY_LENGTH} characters`, 400);
    }

    if (!isAdminSearchType(requestedType)) {
      return secureErrorResponse('Unknown search type', 400);
    }
    const type = requestedType;
    const availableSearchTypes = getAvailableAdminSearchTypes(admin.permissions);
    if (
      type !== 'all'
      && !actorHasPermission(admin, ADMIN_SEARCH_SCOPE_PERMISSIONS[type])
    ) {
      return secureErrorResponse(
        `Your privileges do not include ${type} search`,
        403
      );
    }

    // Each searcher returns its mapped category payload; they run concurrently.
    const searchAccessRequests = async () => {
      if (type !== 'all' && type !== 'requests') return [];
      if (!actorHasPermission(admin, ADMIN_SEARCH_SCOPE_PERMISSIONS.requests)) return [];
      const rows = await prisma.accessRequest.findMany({
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
      const reviews = await resolveRequestReviews(rows, admin);
      return rows.map((req, index) => ({
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
        review: reviews[index],
      }));
    };

    const searchLifecycleActions = async () => {
      if (type !== 'all' && type !== 'lifecycle') return [];
      if (!actorHasPermission(admin, ADMIN_SEARCH_SCOPE_PERMISSIONS.lifecycle)) return [];
      const rows = await prisma.accountLifecycleAction.findMany({
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
      return rows.map((action) => ({
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
    };

    const searchVpnAccounts = async () => {
      if (type !== 'all' && type !== 'vpn') return [];
      if (!actorHasPermission(admin, ADMIN_SEARCH_SCOPE_PERMISSIONS.vpn)) return [];
      const rows = await prisma.vPNAccount.findMany({
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
      return rows.map((vpn) => ({
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
    };

    const searchSupportTickets = async () => {
      if (type !== 'all' && type !== 'tickets') return [];
      if (!actorHasPermission(admin, ADMIN_SEARCH_SCOPE_PERMISSIONS.tickets)) return [];
      const rows = await prisma.supportTicket.findMany({
        where: {
          OR: [
            { id: { contains: query, mode: 'insensitive' } },
            { subject: { contains: query, mode: 'insensitive' } },
            { body: { contains: query, mode: 'insensitive' } },
            { username: { contains: query, mode: 'insensitive' } },
            { relatedRequestId: { contains: query, mode: 'insensitive' } },
            {
              // Ticket bodies hide inside threaded replies; match those too.
              responses: {
                some: { message: { contains: query, mode: 'insensitive' } },
              },
            },
          ],
        },
        take: limit,
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((ticket) => ({
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
    };

    const searchAuditLogs = async () => {
      if (type !== 'all' && type !== 'audit') return [];
      if (!actorHasPermission(admin, ADMIN_SEARCH_SCOPE_PERMISSIONS.audit)) return [];
      const rows = await prisma.auditLog.findMany({
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
      return rows.map((log) => ({
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
    };

    const [accessRequests, lifecycleActions, vpnAccounts, supportTickets, auditLogs] =
      await Promise.all([
        searchAccessRequests(),
        searchLifecycleActions(),
        searchVpnAccounts(),
        searchSupportTickets(),
        searchAuditLogs(),
      ]);

    const results = {
      query,
      accessRequests,
      lifecycleActions,
      vpnAccounts,
      supportTickets,
      auditLogs,
    };

    const totalResults =
      accessRequests.length +
      lifecycleActions.length +
      vpnAccounts.length +
      supportTickets.length +
      auditLogs.length;

    return secureJsonResponse({
      ...results,
      totalResults,
      searchQuery: query,
      searchType: type,
      availableSearchTypes,
    });
  } catch (error) {
    console.error('Search error:', error);
    return secureErrorResponse('Failed to perform search', 500);
  }
}
