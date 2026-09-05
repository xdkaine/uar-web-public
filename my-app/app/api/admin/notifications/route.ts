import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import logger from '@/lib/logger';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { isJsonBodyError, parseAdminJson } from '@/lib/admin-json-parser';

export const dynamic = 'force-dynamic';

type NotificationCreateBody = {
  message?: string;
  type?: string;
  priority?: number;
  isActive?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  dismissible?: boolean;
};

// GET /api/admin/notifications - Get all notification banners
export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!actorHasPermission(admin, 'settings.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const notifications = await prisma.notificationBanner.findMany({
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return NextResponse.json({ notifications });
  } catch (error) {
    logger.error('Error fetching notifications', {
      action: 'fetch_notifications',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to fetch notifications' },
      { status: 500 }
    );
  }
}

// POST /api/admin/notifications - Create a new notification banner
export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!actorHasPermission(admin, 'settings.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const body = await parseAdminJson<NotificationCreateBody>(request);
    const { message, type, priority, isActive, startDate, endDate, dismissible } = body;

    // Validate required fields
    if (!message || !type) {
      return NextResponse.json(
        { error: 'Message and type are required' },
        { status: 400 }
      );
    }

    // Validate type
    const validTypes = ['info', 'warning', 'error', 'success'];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: 'Invalid notification type' },
        { status: 400 }
      );
    }

    // Validate dates if provided
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (end <= start) {
        return NextResponse.json(
          { error: 'End date must be after start date' },
          { status: 400 }
        );
      }
    }

    const notification = await prisma.notificationBanner.create({
      data: {
        message,
        type,
        priority: priority ?? 0,
        isActive: isActive ?? true,
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        dismissible: dismissible ?? true,
        createdBy: admin.username,
      },
    });

    logger.info('Notification banner created', {
      action: 'create_notification',
      notificationId: notification.id,
      createdBy: admin.username,
    });

    // Log notification creation
    await logAuditAction({
      action: AuditActions.CREATE_NOTIFICATION,
      category: AuditCategories.SETTINGS,
      username: admin.username,
      targetId: notification.id,
      targetType: 'Notification',
      details: { type, priority: notification.priority, isActive: notification.isActive },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ 
      notification,
      message: 'Notification created successfully',
    });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    logger.error('Error creating notification', {
      action: 'create_notification',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    
    // Log the failure
    const { admin } = await checkAdminAuthWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.CREATE_NOTIFICATION,
        category: AuditCategories.SETTINGS,
        username: admin.username,
        targetType: 'Notification',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }
    
    return NextResponse.json(
      { error: 'Failed to create notification' },
      { status: 500 }
    );
  }
}
