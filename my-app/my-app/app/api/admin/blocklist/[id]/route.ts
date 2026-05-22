import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { parseJsonWithLimit, MAX_REQUEST_BODY_SIZE, validateStringLength } from '@/lib/validation';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

interface UpdateBlocklistBody {
  reason?: string;
  notes?: string;
  linkedTicketId?: string;
  isActive?: boolean;
  deactivationNotes?: string;
}

// GET - Get a specific blocked email
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

    const blockedEmail = await prisma.blockedEmail.findUnique({
      where: { id },
    });

    if (!blockedEmail) {
      return NextResponse.json(
        { error: 'Blocked email not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ blockedEmail }, { status: 200 });
  } catch (error) {
    console.error('Error fetching blocked email:', error);
    return NextResponse.json(
      { error: 'Failed to fetch blocked email' },
      { status: 500 }
    );
  }
}

// PATCH - Update a blocked email
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

    const body = await parseJsonWithLimit<UpdateBlocklistBody>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const { reason, notes, linkedTicketId, isActive, deactivationNotes } = body;

    const existingBlock = await prisma.blockedEmail.findUnique({
      where: { id },
    });

    if (!existingBlock) {
      return NextResponse.json(
        { error: 'Blocked email not found' },
        { status: 404 }
      );
    }

    // Validate fields if provided
    if (reason) {
      const reasonValidation = validateStringLength(reason, 'Reason', 500, 1);
      if (!reasonValidation.valid) {
        return NextResponse.json({ error: reasonValidation.error }, { status: 400 });
      }
    }

    if (notes) {
      const notesValidation = validateStringLength(notes, 'Notes', 2000);
      if (!notesValidation.valid) {
        return NextResponse.json({ error: notesValidation.error }, { status: 400 });
      }
    }

    if (deactivationNotes) {
      const deactivationNotesValidation = validateStringLength(deactivationNotes, 'Deactivation Notes', 2000);
      if (!deactivationNotesValidation.valid) {
        return NextResponse.json({ error: deactivationNotesValidation.error }, { status: 400 });
      }
    }

    // Verify ticket exists if provided
    if (linkedTicketId) {
      const ticket = await prisma.supportTicket.findUnique({
        where: { id: linkedTicketId },
        select: { id: true, subject: true },
      });

      if (!ticket) {
        return NextResponse.json(
          { error: 'Invalid ticket ID' },
          { status: 400 }
        );
      }
    }

    const updateData: any = {};
    
    if (reason !== undefined) updateData.reason = reason;
    if (notes !== undefined) updateData.notes = notes;
    if (linkedTicketId !== undefined) updateData.linkedTicketId = linkedTicketId;
    
    // Handle deactivation
    if (isActive !== undefined) {
      updateData.isActive = isActive;
      if (!isActive) {
        updateData.deactivatedAt = new Date();
        updateData.deactivatedBy = admin.username;
        if (deactivationNotes) {
          updateData.deactivationNotes = deactivationNotes;
        }
      } else {
        // Reactivating
        updateData.deactivatedAt = null;
        updateData.deactivatedBy = null;
        updateData.deactivationNotes = null;
      }
    }

    const blockedEmail = await prisma.blockedEmail.update({
      where: { id },
      data: updateData,
    });

    // Log blocklist update
    await logAuditAction({
      action: AuditActions.UPDATE_BLOCKLIST,
      category: AuditCategories.BLOCKLIST,
      username: admin.username,
      targetId: id,
      targetType: 'BlockedEmail',
      details: { 
        updatedFields: Object.keys(updateData),
        wasDeactivated: isActive === false,
        wasReactivated: isActive === true
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json(
      { 
        message: 'Blocked email updated successfully',
        blockedEmail,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error updating blocked email:', error);
    return NextResponse.json(
      { error: 'Failed to update blocked email' },
      { status: 500 }
    );
  }
}

// DELETE - Remove a blocked email (hard delete)
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

    const existingBlock = await prisma.blockedEmail.findUnique({
      where: { id },
    });

    if (!existingBlock) {
      return NextResponse.json(
        { error: 'Blocked email not found' },
        { status: 404 }
      );
    }

    await prisma.blockedEmail.delete({
      where: { id },
    });

    // Log blocklist removal
    await logAuditAction({
      action: AuditActions.REMOVE_BLOCKLIST,
      category: AuditCategories.BLOCKLIST,
      username: admin.username,
      targetId: id,
      targetType: 'BlockedEmail',
      details: { email: existingBlock.email },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json(
      { message: 'Blocked email removed successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error deleting blocked email:', error);
    return NextResponse.json(
      { error: 'Failed to delete blocked email' },
      { status: 500 }
    );
  }
}
