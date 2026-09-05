import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkSupportAuth, supportAuthHasPermission } from '@/lib/support-auth';
import { resolveTicketViewAccess } from '@/lib/support/ticket-access';
import { getAssetBytes, sha256Hex } from '@/lib/assets/storage';
import { logAuditAction, getIpAddress, getUserAgent, AuditCategories } from '@/lib/audit-log';
import { timingSafeCompare } from '@/lib/timing-safe';

function asciiFallbackFilename(filename: string): string {
  const cleaned = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return cleaned.length > 0 ? cleaned : 'attachment';
}

function deny(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; attachmentId: string }> }
) {
  try {
    const { auth, response } = await checkSupportAuth();
    if (!auth) {
      return response || deny(401, 'Unauthorized');
    }
    if (!supportAuthHasPermission(auth, 'tickets.read')) {
      return deny(403, 'Forbidden');
    }

    const resolvedParams = await params;
    const ticket = await prisma.supportTicket.findUnique({
      where: { id: resolvedParams.id },
      select: { id: true, username: true, requestedForGroupDn: true, internalOnly: true },
    });
    if (!ticket) {
      return deny(404, 'Ticket not found');
    }

    const viewAccess = await resolveTicketViewAccess(ticket, auth);
    if (!viewAccess) {
      await logAuditAction({
        action: 'view_ticket_attachment',
        category: AuditCategories.SUPPORT,
        username: auth.username,
        targetId: resolvedParams.attachmentId,
        targetType: 'TicketAttachment',
        eventKind: 'security',
        outcome: 'denied',
        details: { ticketId: ticket.id },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
      return deny(403, 'Forbidden');
    }

    const attachment = await prisma.ticketAttachment.findFirst({
      where: { id: resolvedParams.attachmentId, ticketId: ticket.id },
    });
    if (!attachment) {
      return deny(404, 'Ticket not found');
    }
    if (!['clean', 'legacy_unscanned'].includes(attachment.scanStatus)) {
      return deny(404, 'Attachment not available');
    }

    let bytes: Uint8Array;
    try {
      bytes = await getAssetBytes(attachment.storageKey);
    } catch (storageError) {
      console.error('Error reading ticket attachment bytes:', storageError);
      return deny(502, 'Attachment storage is unavailable');
    }

    if (bytes.byteLength !== attachment.sizeBytes) {
      console.error('Attachment size mismatch', {
        storageKey: attachment.storageKey,
        expected: attachment.sizeBytes,
        actual: bytes.byteLength,
      });
      return deny(502, 'Attachment integrity check failed');
    }

    const computedSha256 = sha256Hex(bytes);
    if (!attachment.sha256 || !timingSafeCompare(attachment.sha256, computedSha256)) {
      console.error('Attachment SHA-256 mismatch', {
        storageKey: attachment.storageKey,
        attachmentId: attachment.id,
      });
      await logAuditAction({
        action: 'view_ticket_attachment',
        category: AuditCategories.SUPPORT,
        username: auth.username,
        targetId: attachment.id,
        targetType: 'TicketAttachment',
        eventKind: 'security',
        outcome: 'failure',
        details: {
          ticketId: ticket.id,
          viewerRole: viewAccess,
          reason: 'sha256_mismatch',
        },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
      return deny(502, 'Attachment integrity check failed');
    }

    await logAuditAction({
      action: 'view_ticket_attachment',
      category: AuditCategories.SUPPORT,
      username: auth.username,
      targetId: attachment.id,
      targetType: 'TicketAttachment',
      eventKind: 'read',
      details: {
        ticketId: ticket.id,
        viewerRole: viewAccess,
        sha256: attachment.sha256,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    const inlinePdf = request.nextUrl.searchParams.get('preview') === '1' && attachment.contentType === 'application/pdf' && attachment.scanStatus === 'clean';
    return new NextResponse(bytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': attachment.contentType,
        'Content-Length': String(attachment.sizeBytes),
        'Content-Disposition': `${attachment.forceDownload && !inlinePdf ? 'attachment' : 'inline'}; filename="${asciiFallbackFilename(attachment.filename)}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        ...(inlinePdf ? { 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src 'self' blob: data:" } : {}),
      },
    });
  } catch (error) {
    console.error('Error serving ticket attachment:', error);
    return deny(500, 'Failed to serve attachment');
  }
}
