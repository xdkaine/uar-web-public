import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { createReadStream, promises as fs } from 'node:fs';
import { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { checkSupportAuth, supportAuthHasPermission } from '@/lib/support-auth';
import { resolveTicketMutationAccess, resolveTicketViewAccess } from '@/lib/support/ticket-access';
import { checkRateLimitAsync } from '@/lib/ratelimit';
import { deleteAssetBytes, putAssetBytes, sha256Hex } from '@/lib/assets/storage';
import { classifyAttachment } from '@/lib/assets/attachment-policy';
import { scanAttachmentStream } from '@/lib/assets/clamav';
import {
  cleanupStagedUpload,
  MultipartUploadError,
  stageMultipartUpload,
  type StagedMultipartUpload,
} from '@/lib/assets/multipart-upload';
import { getConfigValue } from '@/lib/config/resolver';
import { logAuditAction, getIpAddress, getUserAgent, AuditCategories } from '@/lib/audit-log';
import { deliverFlowEventOutboxById, enqueueFlowEvent } from '@/lib/flow/outbox';

const HARD_MAX_FILES_PER_TICKET = 100;
const HARD_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
const HARD_MAX_TICKET_BYTES = 2 * 1024 * 1024 * 1024;
const HARD_MAX_REQUEST_BYTES = 25 * 1024 * 1024;

class AttachmentQuotaError extends Error {}

function sanitizeFilename(raw: string): string {
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    // Keep the original when a client sends malformed percent encoding.
  }
  const base = decoded.split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/[\x00-\x1f\x7f"]/g, '').trim();
  return cleaned.slice(0, 200) || 'attachment';
}

async function loadTicketForViewer(ticketId: string) {
  return prisma.supportTicket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      username: true,
      requestedForGroupDn: true,
      internalOnly: true,
      attachmentCount: true,
      attachmentBytes: true,
    },
  });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let staged: StagedMultipartUpload | null = null;
  try {
    const { auth, response } = await checkSupportAuth();
    if (!auth) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!supportAuthHasPermission(auth, 'tickets.respond')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const ticket = await loadTicketForViewer((await params).id);
    if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    const access = await resolveTicketMutationAccess(ticket, auth);
    if (!access) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    const rateLimitResult = await checkRateLimitAsync('support-attachment-upload', {
      maxRequests: 30,
      windowMs: 60 * 60 * 1000,
      identifier: auth.username,
    });
    if (!rateLimitResult.success) {
      return NextResponse.json({ error: 'Too many uploads. Please try again later.' }, { status: 429 });
    }

    const [configuredMaxFiles, configuredMaxFileBytes, configuredMaxTicketBytes] = await Promise.all([
      getConfigValue<number>('attachments.maxFiles'),
      getConfigValue<number>('attachments.maxFileBytes'),
      getConfigValue<number>('attachments.maxTicketBytes'),
    ]);
    const maxFiles = Math.min(configuredMaxFiles, HARD_MAX_FILES_PER_TICKET);
    const maxFileBytes = Math.min(configuredMaxFileBytes, HARD_MAX_ATTACHMENT_BYTES);
    const maxTicketBytes = Math.min(configuredMaxTicketBytes, HARD_MAX_TICKET_BYTES);
    const remainingFiles = maxFiles - Number(ticket.attachmentCount ?? 0);
    if (remainingFiles <= 0) {
      return NextResponse.json({ error: `Tickets allow at most ${maxFiles} attachments` }, { status: 400 });
    }

    staged = await stageMultipartUpload(request, {
      maxFiles,
      maxFileBytes,
      maxRequestBytes: HARD_MAX_REQUEST_BYTES,
    });
    if (staged.files.length > remainingFiles) {
      return NextResponse.json({ error: `Tickets allow at most ${maxFiles} attachments` }, { status: 400 });
    }
    const incomingBytes = staged.files.reduce((sum, file) => sum + file.sizeBytes, 0);
    if (BigInt(ticket.attachmentBytes ?? 0) + BigInt(incomingBytes) > BigInt(maxTicketBytes)) {
      return NextResponse.json({ error: `Ticket attachments exceed the ${maxTicketBytes} byte aggregate limit` }, { status: 400 });
    }

    const inspected: Array<{
      file: StagedMultipartUpload['files'][number];
      bytes: Uint8Array;
      classification: Extract<ReturnType<typeof classifyAttachment>, { ok: true }>;
      scan: Awaited<ReturnType<typeof scanAttachmentStream>>;
    }> = [];
    for (const file of staged.files) {
      const bytes = new Uint8Array(await fs.readFile(file.path));
      const classification = classifyAttachment(file.filename, file.declaredContentType, bytes);
      if (!classification.ok) return NextResponse.json({ error: classification.error }, { status: 400 });
      let scan: Awaited<ReturnType<typeof scanAttachmentStream>>;
      try {
        scan = await scanAttachmentStream(createReadStream(file.path));
      } catch (scanError) {
        console.error('Attachment malware scan failed:', scanError);
        return NextResponse.json({ error: 'Attachment scanning is temporarily unavailable' }, { status: 503 });
      }
      inspected.push({ file, bytes, classification, scan });
    }

    const infected = inspected.filter((entry) => entry.scan.status === 'infected');
    if (infected.length > 0) {
      for (const entry of infected) {
        const extension = entry.classification.extension.replace(/[^a-z0-9]/gi, '') || 'bin';
        const storageKey = `${randomUUID().replace(/-/g, '')}.${extension}`;
        const quarantineId = randomUUID();
        await putAssetBytes(storageKey, entry.bytes);
        try {
          const filename = sanitizeFilename(entry.file.filename || `attachment.${extension}`);
          const outbox = await prisma.$transaction(async (tx) => {
            await tx.quarantinedTicketAttachment.create({
              data: {
                id: quarantineId,
                ticketId: ticket.id,
                filename,
                contentType: entry.classification.contentType,
                sizeBytes: entry.bytes.byteLength,
                sha256: sha256Hex(entry.bytes),
                storageKey,
                uploadedBy: auth.username,
                scanSignature: entry.scan.status === 'infected' ? entry.scan.signature : null,
              },
            });
            return enqueueFlowEvent(tx, {
              triggerKey: 'attachment_malware_detected',
              eventKey: `attachment_malware:${quarantineId}`,
              context: {
                ticketId: ticket.id,
                attachmentId: quarantineId,
                filename,
                uploadedBy: auth.username,
              },
            });
          }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
          void deliverFlowEventOutboxById(outbox.id);
        } catch (databaseError) {
          await deleteAssetBytes(storageKey).catch(() => undefined);
          throw databaseError;
        }
      }
      await logAuditAction({
        action: 'attachment_malware_detected',
        category: AuditCategories.SUPPORT,
        username: auth.username,
        targetId: ticket.id,
        targetType: 'SupportTicket',
        eventKind: 'security',
        outcome: 'denied',
        details: { viewerRole: access, quarantinedCount: infected.length },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
      return NextResponse.json({ error: 'One or more files were quarantined and were not attached to the conversation' }, { status: 422 });
    }

    const records = inspected.map((entry) => ({
      id: randomUUID(),
      ticketId: ticket.id,
      filename: sanitizeFilename(entry.file.filename || `attachment.${entry.classification.extension}`),
      contentType: entry.classification.contentType,
      sizeBytes: entry.bytes.byteLength,
      sha256: sha256Hex(entry.bytes),
      storageKey: `${randomUUID().replace(/-/g, '')}.${entry.classification.extension.replace(/[^a-z0-9]/gi, '') || 'bin'}`,
      uploadedBy: auth.username,
      scanStatus: 'pending',
      scannedAt: new Date(),
      forceDownload: entry.classification.forceDownload,
    }));

    await prisma.$transaction(async (tx) => {
      const claim = await tx.supportTicket.updateMany({
        where: {
          id: ticket.id,
          attachmentCount: { lte: maxFiles - records.length },
          attachmentBytes: { lte: BigInt(maxTicketBytes - incomingBytes) },
        },
        data: {
          attachmentCount: { increment: records.length },
          attachmentBytes: { increment: BigInt(incomingBytes) },
        },
      });
      if (claim.count !== 1) throw new AttachmentQuotaError('Attachment quota changed; refresh and try again');
      await Promise.all(records.map((record) => tx.ticketAttachment.create({ data: record })));
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });

    const storedKeys: string[] = [];
    try {
      for (let index = 0; index < records.length; index += 1) {
        await putAssetBytes(records[index]!.storageKey, inspected[index]!.bytes);
        storedKeys.push(records[index]!.storageKey);
      }
      await prisma.ticketAttachment.updateMany({
        where: { id: { in: records.map((record) => record.id) }, scanStatus: 'pending' },
        data: { scanStatus: 'clean' },
      });
    } catch (storageError) {
      await Promise.all(storedKeys.map((key) => deleteAssetBytes(key).catch(() => undefined)));
      await prisma.$transaction([
        prisma.ticketAttachment.deleteMany({ where: { id: { in: records.map((record) => record.id) } } }),
        prisma.supportTicket.update({
          where: { id: ticket.id },
          data: { attachmentCount: { decrement: records.length }, attachmentBytes: { decrement: BigInt(incomingBytes) } },
        }),
      ]).catch(() => undefined);
      throw storageError;
    }

    const created = records.map(({ id, filename, contentType, sizeBytes }) => ({ id, filename, contentType, sizeBytes }));
    await logAuditAction({
      action: 'upload_ticket_attachment',
      category: AuditCategories.SUPPORT,
      username: auth.username,
      targetId: ticket.id,
      targetType: 'SupportTicket',
      details: { viewerRole: access, attachments: created },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });
    return NextResponse.json({ attachments: created }, { status: 201 });
  } catch (error) {
    if (error instanceof MultipartUploadError) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    if (error instanceof AttachmentQuotaError) return NextResponse.json({ error: error.message }, { status: 409 });
    console.error('Error uploading ticket attachments:', error);
    return NextResponse.json({ error: 'Failed to upload attachments' }, { status: 500 });
  } finally {
    await cleanupStagedUpload(staged);
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { auth, response } = await checkSupportAuth();
    if (!auth) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    if (!supportAuthHasPermission(auth, 'tickets.read')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const ticket = await loadTicketForViewer((await params).id);
    if (!ticket) return NextResponse.json({ error: 'Ticket not found' }, { status: 404 });
    const viewAccess = await resolveTicketViewAccess(ticket, auth);
    if (!viewAccess) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    const attachments = await prisma.ticketAttachment.findMany({
      where: { ticketId: ticket.id, scanStatus: { in: ['clean', 'legacy_unscanned'] } },
      select: {
        id: true,
        filename: true,
        contentType: true,
        sizeBytes: true,
        sha256: true,
        uploadedBy: true,
        createdAt: true,
        scanStatus: true,
        forceDownload: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    return NextResponse.json({ attachments, viewerRole: viewAccess });
  } catch (error) {
    console.error('Error listing ticket attachments:', error);
    return NextResponse.json({ error: 'Failed to list attachments' }, { status: 500 });
  }
}
