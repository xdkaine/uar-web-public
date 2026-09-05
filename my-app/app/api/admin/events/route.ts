import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { isJsonBodyError, parseAdminJson } from '@/lib/admin-json-parser';
import { requireModuleEnabled } from '@/lib/modules/guards';

type EventRequestBody = {
  name?: string;
  description?: string | null;
  endDate?: string | null;
  isActive?: boolean;
};

export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!actorHasPermission(admin, 'events.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const events = await prisma.event.findMany({
      orderBy: {
        createdAt: 'desc',
      },
      include: {
        _count: {
          select: {
            accessRequests: true,
          },
        },
      },
    });

    // Log viewing the event list
    await logAuditAction({
      action: AuditActions.VIEW_EVENT_LIST,
      category: AuditCategories.EVENT,
      username: admin.username,
      details: {
        eventCount: events.length
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ events });
  } catch (error) {
    console.error('Error fetching events:', error);
    return NextResponse.json(
      { error: 'Failed to fetch events' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!actorHasPermission(admin, 'events.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const moduleGuard = await requireModuleEnabled('events');
    if (moduleGuard) return moduleGuard;

    const body = await parseAdminJson<EventRequestBody>(request);
    const { name, description, endDate, isActive } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'Event name is required' },
        { status: 400 }
      );
    }

    const event = await prisma.event.create({
      data: {
        name,
        description: description || null,
        endDate: endDate ? new Date(endDate) : null,
        isActive: isActive !== undefined ? isActive : true,
      },
    });

    // Log event creation
    await logAuditAction({
      action: AuditActions.CREATE_EVENT,
      category: AuditCategories.EVENT,
      username: admin.username,
      targetId: event.id,
      targetType: 'Event',
      details: { name, hasEndDate: !!endDate, isActive: event.isActive },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ event }, { status: 201 });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    console.error('Error creating event:', error);

    // Log the failure
    const { admin } = await checkAdminAuthWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.CREATE_EVENT,
        category: AuditCategories.EVENT,
        username: admin.username,
        targetType: 'Event',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }

    return NextResponse.json(
      { error: 'Failed to create event' },
      { status: 500 }
    );
  }
}
