import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { secureJsonResponse } from '@/lib/apiResponse';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

/**
 * GET /api/admin/ad-comments/[accountId]
 * Get all comments for a specific AD account (by AccessRequest ID)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { accountId } = await params;

    // Verify account exists
    const account = await prisma.accessRequest.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        name: true,
        email: true,
        ldapUsername: true,
      },
    });

    if (!account) {
      return NextResponse.json(
        { error: 'AD account not found' },
        { status: 404 }
      );
    }

    // Fetch comments (exclude soft-deleted unless requested)
    const { searchParams } = new URL(request.url);
    const includeDeleted = searchParams.get('includeDeleted') === 'true';

    const comments = await prisma.aDAccountComment.findMany({
      where: {
        accountId,
        ...(includeDeleted ? {} : { deletedAt: null }),
      },
      orderBy: [
        { isPinned: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return secureJsonResponse({
      account,
      comments,
    });
  } catch (error) {
    console.error('Error fetching AD account comments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch comments' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/ad-comments/[accountId]
 * Add a new comment to an AD account
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ accountId: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { accountId } = await params;
    const body = await request.json();
    const { comment, isInternal = false, isPinned = false } = body;

    if (!comment || !comment.trim()) {
      return NextResponse.json(
        { error: 'Comment text is required' },
        { status: 400 }
      );
    }

    // Verify account exists and get current username
    const account = await prisma.accessRequest.findUnique({
      where: { id: accountId },
      select: {
        id: true,
        name: true,
        ldapUsername: true,
        linkedAdUsername: true,
      },
    });

    if (!account) {
      return NextResponse.json(
        { error: 'AD account not found' },
        { status: 404 }
      );
    }

    const currentUsername = account.ldapUsername || account.linkedAdUsername || 'unknown';

    // Create comment
    const newComment = await prisma.aDAccountComment.create({
      data: {
        accountId,
        accountUsername: currentUsername,
        comment: comment.trim(),
        author: admin.username,
        isInternal,
        isPinned,
      },
    });

    // Log audit action
    await logAuditAction({
      action: AuditActions.CREATE_AD_COMMENT,
      category: AuditCategories.USER,
      username: admin.username,
      targetId: accountId,
      targetType: 'ADAccount',
      details: {
        commentId: newComment.id,
        isInternal,
        isPinned,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return secureJsonResponse(
      {
        success: true,
        comment: newComment,
        message: 'Comment added successfully',
      },
      201
    );
  } catch (error) {
    console.error('Error creating AD account comment:', error);
    return NextResponse.json(
      { error: 'Failed to create comment' },
      { status: 500 }
    );
  }
}
