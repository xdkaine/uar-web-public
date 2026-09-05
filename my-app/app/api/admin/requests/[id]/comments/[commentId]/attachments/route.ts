import { randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { NextRequest, NextResponse } from 'next/server';

import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { classifyAttachment } from '@/lib/assets/attachment-policy';
import { scanAttachmentStream } from '@/lib/assets/clamav';
import {
  cleanupStagedUpload,
  MultipartUploadError,
  stageMultipartUpload,
  type StagedMultipartUpload,
} from '@/lib/assets/multipart-upload';
import { deleteAssetBytes, putAssetBytes, sha256Hex } from '@/lib/assets/storage';
import { logAuditAction, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { prisma } from '@/lib/prisma';
import { actorHasPermission } from '@/lib/rbac/core';
import { checkRateLimitAsync } from '@/lib/ratelimit';

const MAX_COMMENT_FILES = 5;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_REQUEST_BYTES = 25 * 1024 * 1024;

class CommentAttachmentLimitError extends Error {}

function safeFilename(raw: string): string {
  const base = raw.split(/[\\/]/).pop() || 'image';
  return base.replace(/[\x00-\x1f\x7f"]/g, '').trim().slice(0, 200) || 'image';
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> }
) {
  let staged: StagedMultipartUpload | null = null;
  const storedKeys: string[] = [];
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!actorHasPermission(admin, 'access_requests.respond')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const rateLimit = await checkRateLimitAsync('request-comment-attachment-upload', {
      maxRequests: 30,
      windowMs: 60 * 60 * 1000,
      identifier: admin.username,
    });
    if (!rateLimit.success) {
      return NextResponse.json({ error: 'Too many uploads. Please wait and try again.' }, { status: 429 });
    }
    const { id, commentId } = await params;
    const comment = await prisma.requestComment.findFirst({
      where: { id: commentId, requestId: id },
      select: { id: true, author: true, type: true, _count: { select: { attachments: true } } },
    });
    if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 });
    if (comment.type !== null || comment.author.toLowerCase() !== admin.username.toLowerCase()) {
      return NextResponse.json({
        error: 'Images can only be added to your own ordinary comments.',
        code: 'COMMENT_ATTACHMENT_PROVENANCE_REQUIRED',
      }, { status: 403 });
    }

    const remaining = MAX_COMMENT_FILES - comment._count.attachments;
    if (remaining <= 0) {
      return NextResponse.json({ error: `Comments allow at most ${MAX_COMMENT_FILES} images` }, { status: 400 });
    }
    staged = await stageMultipartUpload(request, {
      maxFiles: remaining,
      maxFileBytes: MAX_FILE_BYTES,
      maxRequestBytes: MAX_REQUEST_BYTES,
    });

    const records: Array<{
      id: string;
      commentId: string;
      filename: string;
      contentType: string;
      sizeBytes: number;
      sha256: string;
      storageKey: string;
      uploadedBy: string;
      scanStatus: string;
      forceDownload: boolean;
    }> = [];

    for (const file of staged.files) {
      const bytes = new Uint8Array(await fs.readFile(file.path));
      const classification = classifyAttachment(file.filename, file.declaredContentType, bytes);
      if (!classification.ok || !classification.contentType.startsWith('image/')) {
        await Promise.all(storedKeys.splice(0).map((key) => deleteAssetBytes(key).catch(() => undefined)));
        return NextResponse.json({ error: classification.ok ? 'Comment attachments must be images' : classification.error }, { status: 400 });
      }
      const scan = await scanAttachmentStream(createReadStream(file.path));
      if (scan.status === 'infected') {
        await Promise.all(storedKeys.splice(0).map((key) => deleteAssetBytes(key).catch(() => undefined)));
        await logAuditAction({
          action: 'request_comment_attachment_malware_detected',
          category: AuditCategories.ACCESS_REQUEST,
          username: admin.username,
          targetId: comment.id,
          targetType: 'RequestComment',
          eventKind: 'security',
          outcome: 'denied',
          details: { filename: safeFilename(file.filename), signature: scan.signature },
          ipAddress: getIpAddress(request),
          userAgent: getUserAgent(request),
        });
        return NextResponse.json({ error: 'An image was rejected by malware scanning' }, { status: 422 });
      }

      const storageKey = `${randomUUID().replaceAll('-', '')}.${classification.extension}`;
      await putAssetBytes(storageKey, bytes);
      storedKeys.push(storageKey);
      records.push({
        id: randomUUID(),
        commentId,
        filename: safeFilename(file.filename),
        contentType: classification.contentType,
        sizeBytes: bytes.byteLength,
        sha256: sha256Hex(bytes),
        storageKey,
        uploadedBy: admin.username,
        scanStatus: 'clean',
        forceDownload: false,
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ lock_acquired: string }>>`
        SELECT 'locked'::text AS lock_acquired
        FROM pg_advisory_xact_lock(hashtextextended(${commentId}, 873212))
      `;
      const currentCount = await tx.requestCommentAttachment.count({ where: { commentId } });
      if (currentCount + records.length > MAX_COMMENT_FILES) {
        throw new CommentAttachmentLimitError();
      }
      await tx.requestCommentAttachment.createMany({ data: records });
    });
    await logAuditAction({
      action: 'upload_request_comment_attachment',
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      targetId: comment.id,
      targetType: 'RequestComment',
      details: { requestId: id, attachmentCount: records.length },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    }).catch((auditError) => {
      console.error('Request comment images were stored but audit logging failed:', auditError);
    });
    storedKeys.length = 0;
    return NextResponse.json({ attachments: records.map(({ id: attachmentId, filename, contentType, sizeBytes }) => ({ id: attachmentId, filename, contentType, sizeBytes })) }, { status: 201 });
  } catch (error) {
    await Promise.all(storedKeys.map((key) => deleteAssetBytes(key).catch(() => undefined)));
    if (error instanceof CommentAttachmentLimitError) {
      return NextResponse.json({
        error: `Comments allow at most ${MAX_COMMENT_FILES} images`,
        code: 'COMMENT_ATTACHMENT_LIMIT_REACHED',
      }, { status: 409 });
    }
    if (error instanceof MultipartUploadError) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Error uploading request comment attachments:', error);
    return NextResponse.json({ error: 'Failed to upload comment images' }, { status: 500 });
  } finally {
    await cleanupStagedUpload(staged);
  }
}
