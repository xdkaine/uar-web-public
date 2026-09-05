import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { resolveLDAPUserDisplayNames } from '@/lib/ldap';
import { htmlToPlainText, validateTicketRichText } from '@/lib/ticket-content';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'access_requests.read')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const resolvedParams = await params;

    const comments = await prisma.requestComment.findMany({
      where: { requestId: resolvedParams.id },
      orderBy: { createdAt: 'desc' },
      include: {
        attachments: {
          where: { scanStatus: 'clean' },
          select: { id: true, filename: true, contentType: true, sizeBytes: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    const authors = Array.from(new Set(comments.map((comment) => comment.author).filter(Boolean)));
    let displayNames = new Map<string, string>();
    try {
      displayNames = await resolveLDAPUserDisplayNames(authors);
    } catch {
      // Directory display names are presentation-only; stored usernames remain usable.
    }

    return NextResponse.json({
      comments: comments.map((comment) => ({
        ...comment,
        authorDisplayName: displayNames.get(comment.author.toLowerCase()) || comment.author,
      })),
    });
  } catch (error) {
    console.error('Error fetching comments:', error);
    return NextResponse.json(
      { error: 'Failed to fetch comments' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'access_requests.respond')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const resolvedParams = await params;
    const body = await request.json();
    const { comment } = body;

    if (typeof comment !== 'string') {
      return NextResponse.json(
        { error: 'Comment text is required' },
        { status: 400 }
      );
    }
    const validation = validateTicketRichText(comment, 'Comment');
    if (!validation.valid) {
      return NextResponse.json({ error: validation.error }, { status: 400 });
    }

    const newComment = await prisma.requestComment.create({
      data: {
        requestId: resolvedParams.id,
        comment: validation.sanitized,
        author: admin.username,
      },
    });

    await logAuditAction({
      action: AuditActions.ADD_COMMENT,
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      targetId: resolvedParams.id,
      targetType: 'AccessRequest',
      details: { commentLength: htmlToPlainText(validation.sanitized).length },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ 
      success: true, 
      comment: newComment 
    });
  } catch (error) {
    console.error('Error adding comment:', error);
    
    const resolvedParams = await params;
    const { admin } = await checkAdminAuthWithRateLimit(request);
    if (admin) {
      await logAuditAction({
        action: AuditActions.ADD_COMMENT,
        category: AuditCategories.ACCESS_REQUEST,
        username: admin.username,
        targetId: resolvedParams.id,
        targetType: 'AccessRequest',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }
    
    return NextResponse.json(
      { error: 'Failed to add comment' },
      { status: 500 }
    );
  }
}
