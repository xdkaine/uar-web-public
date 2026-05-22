import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { secureJsonResponse } from '@/lib/apiResponse';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

/**
 * PATCH /api/admin/ad-comments/comment/[id]
 * Update a comment (text, pin status, etc.)
 */
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
    const body = await request.json();
    const { comment, isPinned, isInternal } = body;

    // Fetch existing comment
    const existingComment = await prisma.aDAccountComment.findUnique({
      where: { id },
    });

    if (!existingComment) {
      return NextResponse.json(
        { error: 'Comment not found' },
        { status: 404 }
      );
    }

    if (existingComment.deletedAt) {
      return NextResponse.json(
        { error: 'Cannot update deleted comment' },
        { status: 400 }
      );
    }

    // Build update data
    const updateData: any = {
      updatedAt: new Date(),
    };

    if (comment !== undefined) {
      if (!comment.trim()) {
        return NextResponse.json(
          { error: 'Comment text cannot be empty' },
          { status: 400 }
        );
      }
      updateData.comment = comment.trim();
      updateData.editedAt = new Date();
    }

    if (isPinned !== undefined) {
      updateData.isPinned = isPinned;
    }

    if (isInternal !== undefined) {
      updateData.isInternal = isInternal;
    }

    // Update comment
    const updatedComment = await prisma.aDAccountComment.update({
      where: { id },
      data: updateData,
    });

    // Log audit action
    const auditAction = isPinned !== undefined 
      ? (isPinned ? AuditActions.PIN_AD_COMMENT : AuditActions.UNPIN_AD_COMMENT)
      : AuditActions.UPDATE_AD_COMMENT;

    await logAuditAction({
      action: auditAction,
      category: AuditCategories.USER,
      username: admin.username,
      targetId: existingComment.accountId,
      targetType: 'ADAccount',
      details: {
        commentId: id,
        changes: updateData,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return secureJsonResponse({
      success: true,
      comment: updatedComment,
      message: 'Comment updated successfully',
    });
  } catch (error) {
    console.error('Error updating AD account comment:', error);
    return NextResponse.json(
      { error: 'Failed to update comment' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/ad-comments/comment/[id]
 * Soft delete a comment
 */
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

    // Fetch existing comment
    const existingComment = await prisma.aDAccountComment.findUnique({
      where: { id },
    });

    if (!existingComment) {
      return NextResponse.json(
        { error: 'Comment not found' },
        { status: 404 }
      );
    }

    if (existingComment.deletedAt) {
      return NextResponse.json(
        { error: 'Comment already deleted' },
        { status: 400 }
      );
    }

    // Soft delete
    const deletedComment = await prisma.aDAccountComment.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedBy: admin.username,
      },
    });

    // Log audit action
    await logAuditAction({
      action: AuditActions.DELETE_AD_COMMENT,
      category: AuditCategories.USER,
      username: admin.username,
      targetId: existingComment.accountId,
      targetType: 'ADAccount',
      details: {
        commentId: id,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return secureJsonResponse({
      success: true,
      comment: deletedComment,
      message: 'Comment deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting AD account comment:', error);
    return NextResponse.json(
      { error: 'Failed to delete comment' },
      { status: 500 }
    );
  }
}
