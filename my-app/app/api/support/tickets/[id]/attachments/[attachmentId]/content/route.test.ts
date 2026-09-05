import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createHash } from 'node:crypto';

const mocks = vi.hoisted(() => ({
  checkSupportAuth: vi.fn(),
  resolveTicketViewAccess: vi.fn(),
  getAssetBytes: vi.fn(),
  logAuditAction: vi.fn(),
  supportTicketFindUnique: vi.fn(),
  ticketAttachmentFindFirst: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    supportTicket: { findUnique: mocks.supportTicketFindUnique },
    ticketAttachment: { findFirst: mocks.ticketAttachmentFindFirst },
  },
}));

vi.mock('@/lib/support-auth', () => ({
  checkSupportAuth: mocks.checkSupportAuth,
  supportAuthHasPermission: () => true,
}));

vi.mock('@/lib/support/ticket-access', () => ({
  resolveTicketViewAccess: mocks.resolveTicketViewAccess,
}));

vi.mock('@/lib/assets/storage', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/assets/storage')>()),
  getAssetBytes: mocks.getAssetBytes,
}));

vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.logAuditAction,
  AuditCategories: { SUPPORT: 'support' },
  getIpAddress: () => '203.0.113.10',
  getUserAgent: () => 'attachment-route-test',
}));

import { GET } from './route';

const TICKET = { id: 'ticket-1', username: 'requester', requestedForGroupDn: null };
const ATTACHMENT = {
  id: 'attachment-1',
  ticketId: 'ticket-1',
  filename: 'evidence.png',
  contentType: 'image/png',
  sizeBytes: 11,
  sha256: '',
  storageKey: 'abc123.png',
  uploadedBy: 'requester',
  scanStatus: 'clean',
  forceDownload: false,
};

function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function request() {
  return new NextRequest(
    'https://portal.example.test/api/support/tickets/ticket-1/attachments/attachment-1/content'
  );
}

describe('ticket attachment content route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkSupportAuth.mockResolvedValue({
      auth: { username: 'staff-member' },
      response: null,
    });
    mocks.resolveTicketViewAccess.mockResolvedValue('staff');
    mocks.supportTicketFindUnique.mockResolvedValue(TICKET);
    mocks.ticketAttachmentFindFirst.mockResolvedValue(ATTACHMENT);
    mocks.logAuditAction.mockResolvedValue(undefined);
  });

  it('serves attachment bytes when the stored SHA-256 matches', async () => {
    const bytes = new TextEncoder().encode('hello-blob!');
    mocks.ticketAttachmentFindFirst.mockResolvedValue({
      ...ATTACHMENT,
      sha256: sha256Of(bytes),
    });
    mocks.getAssetBytes.mockResolvedValue(bytes);

    const response = await GET(request(), {
      params: Promise.resolve({ id: 'ticket-1', attachmentId: 'attachment-1' }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('hello-blob!');
    const entry = mocks.logAuditAction.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      action: 'view_ticket_attachment',
      eventKind: 'read',
      targetId: 'attachment-1',
    });
  });

  it('keeps legacy unscanned PDFs download-only even when preview is requested', async () => {
    const bytes = new TextEncoder().encode('%PDF-legacy');
    mocks.ticketAttachmentFindFirst.mockResolvedValue({
      ...ATTACHMENT,
      filename: 'legacy.pdf',
      contentType: 'application/pdf',
      scanStatus: 'legacy_unscanned',
      forceDownload: true,
      sizeBytes: bytes.byteLength,
      sha256: sha256Of(bytes),
    });
    mocks.getAssetBytes.mockResolvedValue(bytes);
    const previewRequest = new NextRequest(
      'https://portal.example.test/api/support/tickets/ticket-1/attachments/attachment-1/content?preview=1'
    );

    const response = await GET(previewRequest, {
      params: Promise.resolve({ id: 'ticket-1', attachmentId: 'attachment-1' }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/);
    expect(response.headers.get('content-security-policy')).toBeNull();
  });

  it('refuses to serve and audits a security event when stored bytes fail integrity', async () => {
    const storedBytes = new TextEncoder().encode('tampered!!!');
    mocks.ticketAttachmentFindFirst.mockResolvedValue({
      ...ATTACHMENT,
      sha256: '0'.repeat(64),
    });
    mocks.getAssetBytes.mockResolvedValue(storedBytes);

    const response = await GET(request(), {
      params: Promise.resolve({ id: 'ticket-1', attachmentId: 'attachment-1' }),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Attachment integrity check failed' });
    expect(mocks.logAuditAction).toHaveBeenCalledTimes(1);
    const entry = mocks.logAuditAction.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      action: 'view_ticket_attachment',
      eventKind: 'security',
      outcome: 'failure',
      targetId: 'attachment-1',
      username: 'staff-member',
    });
    expect((entry.details as Record<string, unknown>).reason).toBe('sha256_mismatch');
  });
});

describe('ticket attachment download access re-check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkSupportAuth.mockResolvedValue({
      auth: { username: 'viewer-1', isAdmin: false },
      response: null,
    });
    mocks.supportTicketFindUnique.mockResolvedValue(TICKET);
    mocks.logAuditAction.mockResolvedValue(undefined);

    const bytes = new TextEncoder().encode('hello-blob!');
    mocks.getAssetBytes.mockResolvedValue(bytes);
    mocks.ticketAttachmentFindFirst.mockResolvedValue({
      ...ATTACHMENT,
      sizeBytes: bytes.byteLength,
      sha256: sha256Of(bytes),
    });
  });

  it.each(['owner', 'admin', 'assignee', 'group_member'] as const)(
    're-checks ticket access and serves the bytes for role %s',
    async (role) => {
      mocks.resolveTicketViewAccess.mockResolvedValue(role);

      const response = await GET(request(), {
        params: Promise.resolve({ id: 'ticket-1', attachmentId: 'attachment-1' }),
      });

      expect(response.status).toBe(200);
      expect(await response.text()).toBe('hello-blob!');
      expect(mocks.resolveTicketViewAccess).toHaveBeenCalledWith(TICKET, {
        username: 'viewer-1',
        isAdmin: false,
      });
      const entry = mocks.logAuditAction.mock.calls[0]?.[0] as Record<string, unknown>;
      expect(entry).toMatchObject({
        action: 'view_ticket_attachment',
        eventKind: 'read',
        targetId: 'attachment-1',
      });
      expect((entry.details as Record<string, unknown>).viewerRole).toBe(role);
    }
  );

  it.each([
    ['an existing attachment', 'attachment-1'],
    ['an unknown attachment', 'unknown-attachment'],
  ])('denies viewers without ticket access before looking up %s', async (_case, attachmentId) => {
    mocks.resolveTicketViewAccess.mockResolvedValue(null);

    const response = await GET(request(), {
      params: Promise.resolve({ id: 'ticket-1', attachmentId }),
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Forbidden' });
    expect(mocks.ticketAttachmentFindFirst).not.toHaveBeenCalled();
    expect(mocks.getAssetBytes).not.toHaveBeenCalled();
    const entry = mocks.logAuditAction.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry).toMatchObject({
      action: 'view_ticket_attachment',
      username: 'viewer-1',
      targetId: attachmentId,
      targetType: 'TicketAttachment',
      eventKind: 'security',
      outcome: 'denied',
    });
    expect((entry.details as Record<string, unknown>).ticketId).toBe('ticket-1');
  });

  it('treats an attachment belonging to another ticket as not found after resolving access', async () => {
    mocks.resolveTicketViewAccess.mockResolvedValue('owner');
    mocks.ticketAttachmentFindFirst.mockResolvedValue(null);

    const response = await GET(request(), {
      params: Promise.resolve({ id: 'ticket-1', attachmentId: 'other-ticket-file' }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Ticket not found' });
    expect(mocks.resolveTicketViewAccess).toHaveBeenCalledWith(TICKET, {
      username: 'viewer-1',
      isAdmin: false,
    });
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
  });

  it('returns 502 when the asset store cannot serve the stored bytes', async () => {
    mocks.resolveTicketViewAccess.mockResolvedValue('owner');
    mocks.getAssetBytes.mockRejectedValue(new Error('storage offline'));

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await GET(request(), {
      params: Promise.resolve({ id: 'ticket-1', attachmentId: 'attachment-1' }),
    });
    consoleError.mockRestore();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Attachment storage is unavailable' });
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
  });

  it('fails closed when stored byte length no longer matches the recorded size', async () => {
    mocks.resolveTicketViewAccess.mockResolvedValue('owner');
    mocks.getAssetBytes.mockResolvedValue(new TextEncoder().encode('wrong-length'));
    mocks.ticketAttachmentFindFirst.mockResolvedValue({
      ...ATTACHMENT,
      sizeBytes: 999,
      sha256: sha256Of(new TextEncoder().encode('wrong-length')),
    });

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await GET(request(), {
      params: Promise.resolve({ id: 'ticket-1', attachmentId: 'attachment-1' }),
    });
    consoleError.mockRestore();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Attachment integrity check failed' });
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
  });

  it('fails closed for legacy rows without a stored SHA-256', async () => {
    mocks.resolveTicketViewAccess.mockResolvedValue('owner');
    const bytes = new TextEncoder().encode('hello-blob!');
    mocks.getAssetBytes.mockResolvedValue(bytes);
    mocks.ticketAttachmentFindFirst.mockResolvedValue({
      ...ATTACHMENT,
      sizeBytes: bytes.byteLength,
      sha256: null,
    });

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const response = await GET(request(), {
      params: Promise.resolve({ id: 'ticket-1', attachmentId: 'attachment-1' }),
    });
    consoleError.mockRestore();

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: 'Attachment integrity check failed' });
    const entry = mocks.logAuditAction.mock.calls[0]?.[0] as Record<string, unknown>;
    expect((entry.details as Record<string, unknown>).reason).toBe('sha256_mismatch');
  });
});
