import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { isJsonBodyError, parseAdminJson } from '@/lib/admin-json-parser';

type EventUpdateBody = {
  name?: string;
  description?: string | null;
  endDate?: string | null;
  isActive?: boolean;
};

// GET - Get specific event
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            accessRequests: true,
          },
        },
      },
    });

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // Log viewing event details
    await logAuditAction({
      action: AuditActions.VIEW_EVENT,
      category: AuditCategories.EVENT,
      username: admin.username,
      targetId: id,
      targetType: 'Event',
      details: {
        eventName: event.name,
        isActive: event.isActive,
        requestCount: event._count.accessRequests,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ event });
  } catch (error) {
    console.error('Error fetching event:', error);
    return NextResponse.json(
      { error: 'Failed to fetch event' },
      { status: 500 }
    );
  }
}

// PATCH - Update event
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await parseAdminJson<EventUpdateBody>(request);
    const { name, description, endDate, isActive } = body;

    const updateData: {
      name?: string;
      description?: string | null;
      endDate?: Date | null;
      isActive?: boolean;
    } = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (endDate !== undefined) updateData.endDate = endDate ? new Date(endDate) : null;
    if (isActive !== undefined) updateData.isActive = isActive;

    const event = await prisma.event.update({
      where: { id },
      data: updateData,
    });

    // Log event update
    await logAuditAction({
      action: AuditActions.UPDATE_EVENT,
      category: AuditCategories.EVENT,
      username: admin.username,
      targetId: id,
      targetType: 'Event',
      details: { updatedFields: Object.keys(updateData) },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ event });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }

    console.error('Error updating event:', error);
    
    // Log the failure
    const { id } = await params;
    const { admin } = await checkAdminAuthWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.UPDATE_EVENT,
        category: AuditCategories.EVENT,
        username: admin.username,
        targetId: id,
        targetType: 'Event',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }
    
    return NextResponse.json(
      { error: 'Failed to update event' },
      { status: 500 }
    );
  }
}

// DELETE - Delete event (soft delete by setting isActive to false)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    // Check if event has associated requests
    const event = await prisma.event.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            accessRequests: true,
          },
        },
      },
    });

    if (!event) {
      return NextResponse.json({ error: 'Event not found' }, { status: 404 });
    }

    // If event has requests, just disable it instead of deleting
    if (event._count.accessRequests > 0) {
      const updatedEvent = await prisma.event.update({
        where: { id },
        data: { isActive: false },
      });
      
      // Log event deactivation
      await logAuditAction({
        action: AuditActions.DEACTIVATE_EVENT,
        category: AuditCategories.EVENT,
        username: admin.username,
        targetId: id,
        targetType: 'Event',
        details: { reason: 'has_associated_requests', requestCount: event._count.accessRequests },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
      
      return NextResponse.json({ 
        event: updatedEvent,
        message: 'Event disabled (has associated requests)'
      });
    }

    // Otherwise, actually delete it
    await prisma.event.delete({
      where: { id },
    });

    // Log event deletion
    await logAuditAction({
      action: AuditActions.DELETE_EVENT,
      category: AuditCategories.EVENT,
      username: admin.username,
      targetId: id,
      targetType: 'Event',
      details: { eventName: event.name },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ message: 'Event deleted' });
  } catch (error) {
    console.error('Error deleting event:', error);
    
    // Log the failure
    const { id } = await params;
    const { admin } = await checkAdminAuthWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.DELETE_EVENT,
        category: AuditCategories.EVENT,
        username: admin.username,
        targetId: id,
        targetType: 'Event',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }
    
    return NextResponse.json(
      { error: 'Failed to delete event' },
      { status: 500 }
    );
  }
}
