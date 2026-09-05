import { findAccountUsernamesByName, resolveAccountDisplayNames } from '@/lib/account-display-names';
import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { checkAdminAuthWithRateLimit, checkAuditAccessWithRateLimit } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent, sanitizeAuditDetails } from '@/lib/audit-log';
import { actorHasPermission } from '@/lib/rbac/core';
import { generateCsvContent } from '@/lib/csv-security';
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
    // Evidence surfaces accept the read-only Auditor role (audit.read) in
    // addition to full administrators; resolution is live-directory backed
    // and fail-closed.
    const { admin, response } = await checkAuditAccessWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Parse query parameters
    const searchParams = request.nextUrl.searchParams;
    const format = searchParams.get('format')?.trim().toLowerCase() || undefined;
    const page = Number(searchParams.get('page') || '1');
    const limit = Number(searchParams.get('limit') || '50');
    if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000 || !Number.isInteger(limit) || limit < 1 || limit > 200) {
      return NextResponse.json({ error: 'Page must be positive and rows per page must be between 1 and 200.' }, { status: 400 });
    }
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
    const search = getFilterValue(searchParams, 'search')?.slice(0, 120);
    if ((startDate && Number.isNaN(Date.parse(startDate))) || (endDate && Number.isNaN(Date.parse(endDate)))
      || (startDate && endDate && new Date(startDate) > new Date(endDate))) {
      return NextResponse.json({ error: 'Choose a valid date range with the start before the end.' }, { status: 400 });
    }
    if (success !== undefined && success !== 'true' && success !== 'false') {
      return NextResponse.json({ error: 'Success must be true or false.' }, { status: 400 });
    }

    // Build where clause
    const where: Prisma.AuditLogWhereInput = {};
    
    if (action) where.action = action;
    if (category) where.category = category;
    if (username) {
      const matchingUsers = await findAccountUsernamesByName(username);
      where.AND = [{ OR: [{ username: { contains: username, mode: 'insensitive' } },
        ...(matchingUsers.length ? [{ username: { in: matchingUsers, mode: 'insensitive' as const } }] : []),
      ] }];
    }
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
      const matchingUsers = await findAccountUsernamesByName(search);
      where.OR = [
        ...(matchingUsers.length ? [{ username: { in: matchingUsers, mode: 'insensitive' as const } }, { subjectUsername: { in: matchingUsers, mode: 'insensitive' as const } }] : []),
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

    // CSV evidence export requires the dedicated export permission; the
    // row cap keeps a single export from unbounded table scans.
    if (format === 'csv') {
      if (!actorHasPermission(admin, 'audit.export')) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
      }
      const EXPORT_ROW_CAP = 5000;
      const exportRows = await prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: EXPORT_ROW_CAP,
      });

      const csv = generateCsvContent(
        ['id', 'createdAt', 'action', 'category', 'eventKind', 'outcome', 'username', 'actorType', 'targetType', 'targetId', 'subjectUsername', 'subjectEmail', 'relatedRequestId', 'correlationId', 'success'],
        exportRows.map((log: Record<string, unknown>) => [
          String(log.id ?? ''),
          log.createdAt instanceof Date ? log.createdAt.toISOString() : String(log.createdAt ?? ''),
          String(log.action ?? ''),
          String(log.category ?? ''),
          String(log.eventKind ?? ''),
          String(log.outcome ?? ''),
          String(log.username ?? ''),
          String(log.actorType ?? ''),
          String(log.targetType ?? ''),
          log.targetId == null ? '' : String(log.targetId),
          log.subjectUsername == null ? '' : String(log.subjectUsername),
          log.subjectEmail == null ? '' : String(log.subjectEmail),
          log.relatedRequestId == null ? '' : String(log.relatedRequestId),
          log.correlationId == null ? '' : String(log.correlationId),
          log.success === null || log.success === undefined ? '' : String(log.success),
        ])
      );

      await logAuditAction({
        action: AuditActions.EXPORT_AUDIT_LOGS,
        category: AuditCategories.LOGS,
        username: admin.username,
        eventKind: 'read',
        outcome: 'success',
        details: { format: 'csv', exportedRows: exportRows.length, filters: { ...where } },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      }).catch(() => {});

      return new NextResponse(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="audit-log-export-${new Date().toISOString().slice(0, 10)}.csv"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    // Calculate offset
    const skip = (page - 1) * limit;

    // Fetch logs with pagination
    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    const displayNames = await resolveAccountDisplayNames(logs.flatMap((log) => [log.username, log.subjectUsername]));
    // Display labels augment immutable audit identities; stored evidence is unchanged.
    const logsWithParsedDetails = logs.map((log: { id: string; details: string | null; [key: string]: unknown }) => ({
      ...log,
      actorDisplayName: typeof log.username === 'string' ? displayNames.get(log.username.toLowerCase()) ?? null : null,
      subjectDisplayName: typeof log.subjectUsername === 'string' ? displayNames.get(log.subjectUsername.toLowerCase()) ?? null : null,
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
