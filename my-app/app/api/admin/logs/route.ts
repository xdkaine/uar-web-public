import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent, sanitizeAuditDetails } from '@/lib/audit-log';
import { isJsonBodyError, parseAdminJson } from '@/lib/admin-json-parser';

type AuditStatsBody = {
  action?: string;
};

function getFilterValue(searchParams: URLSearchParams, key: string): string | undefined {
  const value = searchParams.get(key)?.trim();
  return value && value !== 'all' ? value : undefined;
}

function parseDetails(details: string | null): Record<string, unknown> | null {
  if (!details) return null;
  try {
    return sanitizeAuditDetails(JSON.parse(details)) as Record<string, unknown>;
  } catch {
    return { raw: sanitizeAuditDetails(details) };
  }
}

export async function GET(request: NextRequest) {
  try {
    // Verify admin session with rate limiting
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const action = getFilterValue(searchParams, 'action');
    const category = getFilterValue(searchParams, 'category');
    const username = getFilterValue(searchParams, 'username');
    const actorType = getFilterValue(searchParams, 'actorType');
    const targetType = getFilterValue(searchParams, 'targetType');
    const subjectUsername = getFilterValue(searchParams, 'subjectUsername');
    const subjectEmail = getFilterValue(searchParams, 'subjectEmail');
    const relatedRequestId = getFilterValue(searchParams, 'relatedRequestId');
    const relatedVpnAccountId = getFilterValue(searchParams, 'relatedVpnAccountId');
    const eventKind = getFilterValue(searchParams, 'eventKind');
    const outcome = getFilterValue(searchParams, 'outcome');
    const correlationId = getFilterValue(searchParams, 'correlationId');
    const success = getFilterValue(searchParams, 'success');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const search = searchParams.get('search') || undefined;

    // Build where clause
    const where: Prisma.AuditLogWhereInput = {};
    
    if (action) where.action = action;
    if (category) where.category = category;
    if (username) where.username = { contains: username, mode: 'insensitive' };
    if (actorType) where.actorType = actorType;
    if (targetType) where.targetType = targetType;
    if (subjectUsername) where.subjectUsername = { contains: subjectUsername, mode: 'insensitive' };
    if (subjectEmail) where.subjectEmail = { contains: subjectEmail, mode: 'insensitive' };
    if (relatedRequestId) where.relatedRequestId = relatedRequestId;
    if (relatedVpnAccountId) where.relatedVpnAccountId = relatedVpnAccountId;
    if (eventKind) where.eventKind = eventKind;
    if (outcome) where.outcome = outcome;
    if (correlationId) where.correlationId = correlationId;
    if (success !== undefined) {
      where.success = success === 'true';
    }
    
    // Date range filter
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    // Search across multiple fields
    if (search) {
      where.OR = [
        { action: { contains: search, mode: 'insensitive' } },
        { category: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { actorType: { contains: search, mode: 'insensitive' } },
        { targetType: { contains: search, mode: 'insensitive' } },
        { subjectUsername: { contains: search, mode: 'insensitive' } },
        { subjectEmail: { contains: search, mode: 'insensitive' } },
        { relatedRequestId: { contains: search, mode: 'insensitive' } },
        { relatedVpnAccountId: { contains: search, mode: 'insensitive' } },
        { eventKind: { contains: search, mode: 'insensitive' } },
        { outcome: { contains: search, mode: 'insensitive' } },
        { correlationId: { contains: search, mode: 'insensitive' } },
        { details: { contains: search, mode: 'insensitive' } },
      ];
    }

    // Calculate offset
    const skip = (page - 1) * limit;

    // Fetch logs with pagination
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    // Parse details JSON for each log
    const logsWithParsedDetails = logs.map((log: { id: string; details: string | null; [key: string]: unknown }) => ({
      ...log,
      details: parseDetails(log.details),
    }));

    // Log this view action
    await logAuditAction({
      action: AuditActions.VIEW_AUDIT_LOGS,
      category: AuditCategories.LOGS,
      username: admin.username,
      actorType: 'admin',
      eventKind: 'read',
      outcome: 'success',
      details: {
        page,
        limit,
        filters: {
          action,
          category,
          username,
          actorType,
          targetType,
          subjectUsername,
          subjectEmail,
          relatedRequestId,
          relatedVpnAccountId,
          eventKind,
          outcome,
          correlationId,
          success,
          startDate,
          endDate,
          search,
        },
        totalResults: total,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({
      logs: logsWithParsedDetails,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return NextResponse.json(
      { error: 'Failed to fetch audit logs' },
      { status: 500 }
    );
  }
}

// Export stats endpoint for dashboard
export async function POST(request: NextRequest) {
  try {
    // Verify admin session

    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await parseAdminJson<AuditStatsBody>(request);
    const { action: statsAction } = body;

    if (statsAction === 'get_stats') {
      // Get stats for the last 24 hours, 7 days, and 30 days
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

      const [last24h, last7d, last30d, topUsers, topActions, actionsByCategory] = await Promise.all([
        prisma.auditLog.count({ where: { createdAt: { gte: oneDayAgo } } }),
        prisma.auditLog.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
        prisma.auditLog.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
        
        // Top 5 most active users in last 7 days
        prisma.auditLog.groupBy({
          by: ['username'],
          where: { createdAt: { gte: sevenDaysAgo } },
          _count: { username: true },
          orderBy: { _count: { username: 'desc' } },
          take: 5,
        }),
        
        // Top 10 most common actions in last 7 days
        prisma.auditLog.groupBy({
          by: ['action'],
          where: { createdAt: { gte: sevenDaysAgo } },
          _count: { action: true },
          orderBy: { _count: { action: 'desc' } },
          take: 10,
        }),

        // Actions by category in last 7 days
        prisma.auditLog.groupBy({
          by: ['category'],
          where: { createdAt: { gte: sevenDaysAgo } },
          _count: { category: true },
          orderBy: { _count: { category: 'desc' } },
        }),
      ]);

      return NextResponse.json({
        stats: {
          last24Hours: last24h,
          last7Days: last7d,
          last30Days: last30d,
          topUsers: topUsers.map((u: { username: string; _count: { username: number } }) => ({ username: u.username, count: u._count.username })),
          topActions: topActions.map((a: { action: string; _count: { action: number } }) => ({ action: a.action, count: a._count.action })),
          actionsByCategory: actionsByCategory.map((c: { category: string; _count: { category: number } }) => ({ category: c.category, count: c._count.category })),
        },
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    console.error('Error processing audit log request:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
