import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import logger from '@/lib/logger';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { isJsonBodyError, parseAdminJson } from '@/lib/admin-json-parser';

export const dynamic = 'force-dynamic';

type NotificationUpdateBody = {
  message?: string;
  type?: string;
  priority?: number;
  isActive?: boolean;
  startDate?: string | null;
  endDate?: string | null;
  dismissible?: boolean;
};

// PATCH /api/admin/notifications/[id] - Update a notification banner
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // `params` may be a Promise in Next.js route handlers — unwrap it before use
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Missing notification id' }, { status: 400 });
    }
    const body = await parseAdminJson<NotificationUpdateBody>(request);
    const { message, type, priority, isActive, startDate, endDate, dismissible } = body;

    // Check if notification exists
    const existingNotification = await prisma.notificationBanner.findUnique({
      where: { id },
    });

    if (!existingNotification) {
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
      );
    }

    // Validate type if provided
    if (type) {
      const validTypes = ['info', 'warning', 'error', 'success'];
      if (!validTypes.includes(type)) {
        return NextResponse.json(
          { error: 'Invalid notification type' },
          { status: 400 }
        );
      }
    }

    // Validate dates if both provided
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

    // Build update data
    const updateData: Prisma.NotificationBannerUpdateInput = {};
    if (message !== undefined) updateData.message = message;
    if (type !== undefined) updateData.type = type;
    if (priority !== undefined) updateData.priority = priority;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (dismissible !== undefined) updateData.dismissible = dismissible;
    if (startDate !== undefined) updateData.startDate = startDate ? new Date(startDate) : null;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;

    const notification = await prisma.notificationBanner.update({
      where: { id },
      data: updateData,
    });

    logger.info('Notification banner updated', {
      action: 'update_notification',
      notificationId: notification.id,
      updatedBy: admin.username,
    });

    // Log notification update
    await logAuditAction({
      action: AuditActions.UPDATE_NOTIFICATION,
      category: AuditCategories.SETTINGS,
      username: admin.username,
      targetId: id,
      targetType: 'Notification',
      details: { updatedFields: Object.keys(updateData) },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ 
      notification,
      message: 'Notification updated successfully',
    });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    logger.error('Error updating notification', {
      action: 'update_notification',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to update notification' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/notifications/[id] - Delete a notification banner
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // `params` may be a Promise in Next.js route handlers — unwrap it before use
    const { id } = await params;

    if (!id) {
      return NextResponse.json({ error: 'Missing notification id' }, { status: 400 });
    }

    // Check if notification exists
    const existingNotification = await prisma.notificationBanner.findUnique({
      where: { id },
    });

    if (!existingNotification) {
      return NextResponse.json(
        { error: 'Notification not found' },
        { status: 404 }
      );
    }

    await prisma.notificationBanner.delete({
      where: { id },
    });

    logger.info('Notification banner deleted', {
      action: 'delete_notification',
      notificationId: id,
      deletedBy: admin.username,
    });

    // Log notification deletion
    await logAuditAction({
      action: AuditActions.DELETE_NOTIFICATION,
      category: AuditCategories.SETTINGS,
      username: admin.username,
      targetId: id,
      targetType: 'Notification',
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ 
      message: 'Notification deleted successfully',
    });
  } catch (error) {
    logger.error('Error deleting notification', {
      action: 'delete_notification',
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { error: 'Failed to delete notification' },
      { status: 500 }
    );
  }
}
