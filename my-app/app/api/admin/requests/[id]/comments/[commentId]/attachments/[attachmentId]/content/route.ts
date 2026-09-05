import { NextRequest, NextResponse } from 'next/server';

import { checkReviewAccessWithRateLimit } from '@/lib/adminAuth';
import { getAssetBytes, sha256Hex } from '@/lib/assets/storage';
import { prisma } from '@/lib/prisma';
import { actorHasPermission } from '@/lib/rbac/core';
import { timingSafeCompare } from '@/lib/timing-safe';

function asciiFilename(filename: string): string {
  return filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_') || 'image';
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string; attachmentId: string }> }
) {
  const { admin, response } = await checkReviewAccessWithRateLimit(request);
  if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actorHasPermission(admin, 'access_requests.read')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id, commentId, attachmentId } = await params;
  const attachment = await prisma.requestCommentAttachment.findFirst({
    where: { id: attachmentId, commentId, comment: { requestId: id }, scanStatus: 'clean' },
  });
  if (!attachment) return NextResponse.json({ error: 'Attachment not found' }, { status: 404 });

  try {
    const bytes = await getAssetBytes(attachment.storageKey);
    if (bytes.byteLength !== attachment.sizeBytes || !timingSafeCompare(attachment.sha256, sha256Hex(bytes))) {
      return NextResponse.json({ error: 'Attachment integrity check failed' }, { status: 502 });
    }
    return new NextResponse(bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': attachment.contentType,
        'Content-Length': String(attachment.sizeBytes),
        'Content-Disposition': `inline; filename="${asciiFilename(attachment.filename)}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Error serving request comment attachment:', error);
    return NextResponse.json({ error: 'Attachment storage is unavailable' }, { status: 502 });
  }
}
