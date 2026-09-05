import { NextRequest, NextResponse } from 'next/server';

import { AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { textPreviewLanguage } from '@/lib/assets/attachment-policy';
import { getAssetBytes, sha256Hex } from '@/lib/assets/storage';
import { prisma } from '@/lib/prisma';
import { checkSupportAuth, supportAuthHasPermission } from '@/lib/support-auth';
import { resolveTicketViewAccess } from '@/lib/support/ticket-access';
import { timingSafeCompare } from '@/lib/timing-safe';

const PREVIEW_BYTES = 1024 * 1024;

function deny(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  try {
    const { auth, response } = await checkSupportAuth();
    if (!auth) return response || deny(401, 'Unauthorized');
    if (!supportAuthHasPermission(auth, 'tickets.read')) return deny(403, 'Forbidden');
    const resolved = await params;
    const ticket = await prisma.supportTicket.findUnique({ where: { id: resolved.id }, select: { id: true, username: true, requestedForGroupDn: true, internalOnly: true } });
    if (!ticket) return deny(404, 'Ticket not found');
    const viewAccess = await resolveTicketViewAccess(ticket, auth);
    if (!viewAccess) {
      await logAuditAction({
        action: 'preview_ticket_attachment',
        category: AuditCategories.SUPPORT,
        username: auth.username,
        targetId: ticket.id,
        targetType: 'SupportTicket',
        eventKind: 'security',
        outcome: 'denied',
        details: { ticketId: ticket.id, attachmentId: resolved.attachmentId },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
      return deny(403, 'Forbidden');
    }
    const attachment = await prisma.ticketAttachment.findFirst({ where: { id: resolved.attachmentId, ticketId: ticket.id } });
    if (!attachment || !['clean', 'legacy_unscanned'].includes(attachment.scanStatus)) return deny(404, 'Attachment not available');
    const language = textPreviewLanguage(attachment.filename);
    if (!language || attachment.contentType !== 'text/plain') return deny(415, 'This attachment is download-only');
    const bytes = await getAssetBytes(attachment.storageKey);
    if (bytes.byteLength !== attachment.sizeBytes || !attachment.sha256 || !timingSafeCompare(attachment.sha256, sha256Hex(bytes))) {
      return deny(502, 'Attachment integrity check failed');
    }
    const preview = bytes.slice(0, PREVIEW_BYTES);
    const text = new TextDecoder('utf-8', { fatal: false }).decode(preview);
    await logAuditAction({
      action: 'preview_ticket_attachment',
      category: AuditCategories.SUPPORT,
      username: auth.username,
      targetId: attachment.id,
      targetType: 'TicketAttachment',
      eventKind: 'read',
      outcome: 'success',
      details: { ticketId: ticket.id, viewerRole: viewAccess, previewBytes: preview.byteLength, truncated: bytes.byteLength > PREVIEW_BYTES },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });
    return NextResponse.json({
      filename: attachment.filename,
      language,
      text,
      sizeBytes: attachment.sizeBytes,
      previewBytes: preview.byteLength,
      truncated: bytes.byteLength > PREVIEW_BYTES,
    }, { headers: { 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    console.error('Error previewing ticket attachment:', error);
    return deny(500, 'Failed to preview attachment');
  }
}
