import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  checkSupportAuth: vi.fn(),
  resolveTicketMutationAccess: vi.fn(),
  resolveTicketViewAccess: vi.fn(),
  checkRateLimitAsync: vi.fn(),
  putAssetBytes: vi.fn(),
  deleteAssetBytes: vi.fn(),
  scanAttachmentStream: vi.fn(),
  getConfigValue: vi.fn(),
  enqueueFlowEvent: vi.fn(),
  deliverFlowEventOutboxById: vi.fn(),
  logAuditAction: vi.fn(),
  supportTicketFindUnique: vi.fn(),
  supportTicketUpdateMany: vi.fn(),
  supportTicketUpdate: vi.fn(),
  ticketAttachmentCreate: vi.fn(),
  ticketAttachmentUpdateMany: vi.fn(),
  ticketAttachmentDeleteMany: vi.fn(),
  quarantinedTicketAttachmentCreate: vi.fn(),
  ticketAttachmentFindMany: vi.fn(),
  prismaTransaction: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    supportTicket: {
      findUnique: mocks.supportTicketFindUnique,
      updateMany: mocks.supportTicketUpdateMany,
      update: mocks.supportTicketUpdate,
    },
    ticketAttachment: {
      create: mocks.ticketAttachmentCreate,
      updateMany: mocks.ticketAttachmentUpdateMany,
      deleteMany: mocks.ticketAttachmentDeleteMany,
      findMany: mocks.ticketAttachmentFindMany,
    },
    quarantinedTicketAttachment: { create: mocks.quarantinedTicketAttachmentCreate },
    $transaction: mocks.prismaTransaction,
  },
}));

vi.mock('@/lib/support-auth', () => ({
  checkSupportAuth: mocks.checkSupportAuth,
  supportAuthHasPermission: () => true,
}));

vi.mock('@/lib/support/ticket-access', () => ({
  resolveTicketMutationAccess: mocks.resolveTicketMutationAccess,
  resolveTicketViewAccess: mocks.resolveTicketViewAccess,
}));

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimitAsync: mocks.checkRateLimitAsync,
}));

vi.mock('@/lib/assets/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/assets/storage')>()),
  putAssetBytes: mocks.putAssetBytes,
  deleteAssetBytes: mocks.deleteAssetBytes,
}));

vi.mock('@/lib/assets/clamav', () => ({
  scanAttachmentStream: mocks.scanAttachmentStream,
}));

vi.mock('@/lib/config/resolver', () => ({
  getConfigValue: mocks.getConfigValue,
}));

vi.mock('@/lib/flow/outbox', () => ({
  enqueueFlowEvent: mocks.enqueueFlowEvent,
  deliverFlowEventOutboxById: mocks.deliverFlowEventOutboxById,
}));

vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.logAuditAction,
  AuditCategories: { SUPPORT: 'support' },
  getIpAddress: () => '203.0.113.10',
  getUserAgent: () => 'attachment-upload-test',
}));

import { GET, POST } from './route';
import { MAX_ATTACHMENT_BYTES, sha256Hex } from '@/lib/assets/storage';

const TICKET = {
  id: 'ticket-1',
  username: 'requester',
  requestedForGroupDn: null,
  internalOnly: false,
  attachmentCount: 0,
  attachmentBytes: BigInt(0),
};

function pngBytes(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
}

function uploadRequest(files: File[]) {
  const form = new FormData();
  for (const file of files) {
    form.append('files', file);
  }
  return new NextRequest(
    'https://portal.example.test/api/support/tickets/ticket-1/attachments',
    { method: 'POST', body: form }
  );
}

function listRequest() {
  return new NextRequest(
    'https://portal.example.test/api/support/tickets/ticket-1/attachments'
  );
}

function pngFile(overrides: { name?: string; type?: string; bytes?: Uint8Array<ArrayBuffer> } = {}) {
  const bytes = overrides.bytes ?? pngBytes();
  return new File([bytes], overrides.name ?? 'evidence.png', {
    type: overrides.type ?? 'image/png',
  });
}

describe('ticket attachment uploads', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkSupportAuth.mockResolvedValue({
      auth: { username: 'staff-member', isAdmin: false },
      response: null,
    });
    mocks.supportTicketFindUnique.mockResolvedValue(TICKET);
    mocks.resolveTicketMutationAccess.mockResolvedValue('staff');
    mocks.resolveTicketViewAccess.mockResolvedValue('staff');
    mocks.checkRateLimitAsync.mockResolvedValue({
      success: true,
      limit: 30,
      remaining: 29,
      reset: Date.now() + 60_000,
    });
    mocks.getConfigValue.mockImplementation(async (key: string) => ({
      'attachments.maxFiles': 50,
      'attachments.maxFileBytes': 50 * 1024 * 1024,
      'attachments.maxTicketBytes': 1024 * 1024 * 1024,
    })[key]);
    mocks.putAssetBytes.mockResolvedValue({ location: 'local' });
    mocks.deleteAssetBytes.mockResolvedValue(undefined);
    mocks.scanAttachmentStream.mockResolvedValue({ status: 'clean' });
    mocks.enqueueFlowEvent.mockResolvedValue({ id: 'outbox-1' });
    mocks.deliverFlowEventOutboxById.mockResolvedValue(true);
    mocks.ticketAttachmentCreate.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ id: 'attachment-new', ...data })
    );
    mocks.ticketAttachmentFindMany.mockResolvedValue([]);
    mocks.ticketAttachmentUpdateMany.mockResolvedValue({ count: 1 });
    mocks.ticketAttachmentDeleteMany.mockResolvedValue({ count: 1 });
    mocks.supportTicketUpdateMany.mockResolvedValue({ count: 1 });
    mocks.supportTicketUpdate.mockResolvedValue({});
    mocks.quarantinedTicketAttachmentCreate.mockImplementation(
      async ({ data }: { data: Record<string, unknown> }) => ({ id: 'quarantine-new', ...data })
    );
    mocks.prismaTransaction.mockImplementation(async (input: unknown) => {
      if (typeof input === 'function') {
        return input({
          supportTicket: { updateMany: mocks.supportTicketUpdateMany },
          ticketAttachment: { create: mocks.ticketAttachmentCreate },
          quarantinedTicketAttachment: { create: mocks.quarantinedTicketAttachmentCreate },
        });
      }
      return Promise.all(input as Promise<unknown>[]);
    });
    mocks.logAuditAction.mockResolvedValue(undefined);
  });

  it('accepts a PNG by magic bytes, stores it, and audits the upload', async () => {
    const bytes = pngBytes();
    const response = await POST(uploadRequest([pngFile()]), {
      params: Promise.resolve({ id: 'ticket-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.attachments).toHaveLength(1);
    expect(mocks.putAssetBytes).toHaveBeenCalledTimes(1);
    const [storageKey] = mocks.putAssetBytes.mock.calls[0] as [string, Uint8Array];
    expect(storageKey).toMatch(/\.png$/);
    expect(mocks.ticketAttachmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        ticketId: 'ticket-1',
        filename: 'evidence.png',
        contentType: 'image/png',
        sizeBytes: bytes.byteLength,
        sha256: sha256Hex(bytes),
        uploadedBy: 'staff-member',
        storageKey,
      }),
    });
    expect(mocks.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'upload_ticket_attachment',
        username: 'staff-member',
        targetId: 'ticket-1',
        targetType: 'SupportTicket',
      })
    );
    const entry = mocks.logAuditAction.mock.calls[0]?.[0] as Record<string, unknown>;
    expect((entry.details as Record<string, unknown>).viewerRole).toBe('staff');
  });

  it('trusts magic bytes over the client-declared content type', async () => {
    const response = await POST(
      uploadRequest([pngFile({ name: 'mislabeled.png', type: 'application/octet-stream' })]),
      { params: Promise.resolve({ id: 'ticket-1' }) }
    );

    expect(response.status).toBe(201);
    expect(mocks.ticketAttachmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ contentType: 'image/png' }),
    });
  });

  it('quarantines malware, emits a typed workflow event, and never returns downloadable evidence', async () => {
    mocks.scanAttachmentStream.mockResolvedValue({ status: 'infected', signature: 'Win.Test.EICAR_HDB-1' });

    const response = await POST(uploadRequest([pngFile({ name: 'infected.png' })]), {
      params: Promise.resolve({ id: 'ticket-1' }),
    });

    expect(response.status).toBe(422);
    expect(mocks.quarantinedTicketAttachmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        scanSignature: 'Win.Test.EICAR_HDB-1',
      }),
    });
    expect(mocks.enqueueFlowEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        triggerKey: 'attachment_malware_detected',
        eventKey: expect.stringContaining('attachment_malware:'),
        context: expect.objectContaining({ ticketId: 'ticket-1', filename: 'infected.png' }),
      })
    );
  });

  it('rejects executable files before storage', async () => {
    const executable = new Uint8Array([0x4d, 0x5a, 1, 2, 3]);

    const response = await POST(
      uploadRequest([new File([executable], 'tool.exe', { type: 'application/octet-stream' })]),
      { params: Promise.resolve({ id: 'ticket-1' }) }
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/Executable/);
    expect(mocks.putAssetBytes).not.toHaveBeenCalled();
    expect(mocks.ticketAttachmentCreate).not.toHaveBeenCalled();
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
  });

  it.each([
    ['oversized', () => new File([new Uint8Array(MAX_ATTACHMENT_BYTES + 1)], 'big.png', { type: 'image/png' })],
    ['empty', () => new File([], 'blank.png', { type: 'image/png' })],
  ])('rejects %s files with 400 before touching storage', async (_label, makeFile) => {
    const response = await POST(uploadRequest([makeFile()]), {
      params: Promise.resolve({ id: 'ticket-1' }),
    });

    expect(response.status).toBe(_label === 'oversized' ? 413 : 400);
    expect(mocks.putAssetBytes).not.toHaveBeenCalled();
    expect(mocks.ticketAttachmentCreate).not.toHaveBeenCalled();
  });

  it('rate limits uploads per user before reading any file', async () => {
    mocks.checkRateLimitAsync.mockResolvedValue({
      success: false,
      limit: 30,
      remaining: 0,
      reset: Date.now() + 60_000,
    });

    const response = await POST(uploadRequest([pngFile()]), {
      params: Promise.resolve({ id: 'ticket-1' }),
    });

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: 'Too many uploads. Please try again later.' });
    expect(mocks.checkRateLimitAsync).toHaveBeenCalledWith(
      'support-attachment-upload',
      expect.objectContaining({ identifier: 'staff-member' })
    );
    expect(mocks.putAssetBytes).not.toHaveBeenCalled();
    expect(mocks.ticketAttachmentCreate).not.toHaveBeenCalled();
  });

  it('caps the number of attachments per ticket', async () => {
    mocks.supportTicketFindUnique.mockResolvedValue({ ...TICKET, attachmentCount: 49 });

    const response = await POST(
      uploadRequest([pngFile({ name: 'one.png' }), pngFile({ name: 'two.png' })]),
      { params: Promise.resolve({ id: 'ticket-1' }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Tickets allow at most 50 attachments' });
    expect(mocks.putAssetBytes).not.toHaveBeenCalled();
  });

  it('rejects non-multipart bodies with 400', async () => {
    const response = await POST(
      new NextRequest(
        'https://portal.example.test/api/support/tickets/ticket-1/attachments',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ files: [] }),
        }
      ),
      { params: Promise.resolve({ id: 'ticket-1' }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: 'Expected multipart form data with a files field',
    });
    expect(mocks.putAssetBytes).not.toHaveBeenCalled();
  });

  it('rejects requests without any files field entries', async () => {
    const form = new FormData();
    form.append('note', 'no files here');

    const response = await POST(
      new NextRequest(
        'https://portal.example.test/api/support/tickets/ticket-1/attachments',
        { method: 'POST', body: form }
      ),
      { params: Promise.resolve({ id: 'ticket-1' }) }
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'No files were uploaded' });
  });

  it('returns 403 when the viewer may not mutate the ticket', async () => {
    mocks.resolveTicketMutationAccess.mockResolvedValue(null);

    const response = await POST(uploadRequest([pngFile()]), {
      params: Promise.resolve({ id: 'ticket-1' }),
    });

    expect(response.status).toBe(403);
    expect(mocks.checkRateLimitAsync).not.toHaveBeenCalled();
    expect(mocks.putAssetBytes).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown ticket', async () => {
    mocks.supportTicketFindUnique.mockResolvedValue(null);

    const response = await POST(uploadRequest([pngFile()]), {
      params: Promise.resolve({ id: 'missing-ticket' }),
    });

    expect(response.status).toBe(404);
    expect(mocks.resolveTicketMutationAccess).not.toHaveBeenCalled();
  });

  it('returns 401 without a support session', async () => {
    mocks.checkSupportAuth.mockResolvedValue({ auth: null });

    const response = await POST(uploadRequest([pngFile()]), {
      params: Promise.resolve({ id: 'ticket-1' }),
    });

    expect(response.status).toBe(401);
    expect(mocks.supportTicketFindUnique).not.toHaveBeenCalled();
  });

  it('sanitizes hostile filenames before persisting', async () => {
    await POST(uploadRequest([pngFile({ name: '..\\..\\we"ird\tname.png' })]), {
      params: Promise.resolve({ id: 'ticket-1' }),
    });

    expect(mocks.ticketAttachmentCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ filename: 'weirdname.png' }),
    });
  });
});

describe('ticket attachment listing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkSupportAuth.mockResolvedValue({
      auth: { username: 'group-member', isAdmin: false },
      response: null,
    });
    mocks.supportTicketFindUnique.mockResolvedValue(TICKET);
    mocks.resolveTicketViewAccess.mockResolvedValue('group_member');
    mocks.ticketAttachmentFindMany.mockResolvedValue([
      {
        id: 'attachment-1',
        filename: 'evidence.png',
        contentType: 'image/png',
        sizeBytes: 11,
        sha256: 'a'.repeat(64),
        uploadedBy: 'requester',
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
    ]);
    mocks.logAuditAction.mockResolvedValue(undefined);
  });

  it('scopes the listing to the requested ticket and reports the viewer role', async () => {
    const response = await GET(listRequest(), {
      params: Promise.resolve({ id: 'ticket-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.viewerRole).toBe('group_member');
    expect(body.attachments).toHaveLength(1);
    expect(body.attachments[0]).toMatchObject({ id: 'attachment-1', filename: 'evidence.png' });
    expect(mocks.ticketAttachmentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { ticketId: 'ticket-1', scanStatus: { in: ['clean', 'legacy_unscanned'] } },
        orderBy: { createdAt: 'asc' },
      })
    );
  });

  it('denies viewers without ticket access', async () => {
    mocks.resolveTicketViewAccess.mockResolvedValue(null);

    const response = await GET(listRequest(), {
      params: Promise.resolve({ id: 'ticket-1' }),
    });

    expect(response.status).toBe(403);
    expect(mocks.ticketAttachmentFindMany).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown ticket without querying attachments', async () => {
    mocks.supportTicketFindUnique.mockResolvedValue(null);

    const response = await GET(listRequest(), {
      params: Promise.resolve({ id: 'missing-ticket' }),
    });

    expect(response.status).toBe(404);
    expect(mocks.resolveTicketViewAccess).not.toHaveBeenCalled();
    expect(mocks.ticketAttachmentFindMany).not.toHaveBeenCalled();
  });
});
