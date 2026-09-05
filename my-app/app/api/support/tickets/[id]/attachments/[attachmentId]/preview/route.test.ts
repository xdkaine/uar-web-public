import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  getUserAgent: () => 'attachment-preview-test',
}));

import { GET } from './route';

const TICKET = {
  id: 'ticket-1',
  username: 'requester',
  requestedForGroupDn: null,
  internalOnly: false,
};

function sha256Of(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function request() {
  return new NextRequest(
    'https://portal.example.test/api/support/tickets/ticket-1/attachments/attachment-1/preview'
  );
}

async function invoke() {
  return GET(request(), {
    params: Promise.resolve({ id: 'ticket-1', attachmentId: 'attachment-1' }),
  });
}

describe('ticket attachment text preview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkSupportAuth.mockResolvedValue({
      auth: { username: 'staff-member', isAdmin: true },
      response: null,
    });
    mocks.resolveTicketViewAccess.mockResolvedValue('admin');
    mocks.supportTicketFindUnique.mockResolvedValue(TICKET);
    mocks.logAuditAction.mockResolvedValue(undefined);
  });

  it('returns a private, integrity-checked preview with language metadata', async () => {
    const bytes = new TextEncoder().encode('const answer: number = 42;\n');
    mocks.getAssetBytes.mockResolvedValue(bytes);
    mocks.ticketAttachmentFindFirst.mockResolvedValue({
      id: 'attachment-1',
      ticketId: 'ticket-1',
      filename: 'answer.ts',
      contentType: 'text/plain',
      sizeBytes: bytes.byteLength,
      sha256: sha256Of(bytes),
      storageKey: 'abc123.ts',
      scanStatus: 'clean',
    });

    const response = await invoke();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(body).toMatchObject({
      filename: 'answer.ts',
      language: 'typescript',
      text: 'const answer: number = 42;\n',
      previewBytes: bytes.byteLength,
      truncated: false,
    });
    expect(mocks.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'preview_ticket_attachment', eventKind: 'read' })
    );
  });

  it('caps preview content at 1 MiB and reports truncation', async () => {
    const bytes = new TextEncoder().encode(`${'a'.repeat(1024 * 1024)}tail`);
    mocks.getAssetBytes.mockResolvedValue(bytes);
    mocks.ticketAttachmentFindFirst.mockResolvedValue({
      id: 'attachment-1',
      ticketId: 'ticket-1',
      filename: 'large.log',
      contentType: 'text/plain',
      sizeBytes: bytes.byteLength,
      sha256: sha256Of(bytes),
      storageKey: 'abc123.log',
      scanStatus: 'clean',
    });

    const response = await invoke();
    const body = await response.json();

    expect(body.previewBytes).toBe(1024 * 1024);
    expect(body.text).toHaveLength(1024 * 1024);
    expect(body.truncated).toBe(true);
  });

  it('denies preview before reading bytes when ticket access is absent', async () => {
    mocks.resolveTicketViewAccess.mockResolvedValue(null);
    mocks.ticketAttachmentFindFirst.mockResolvedValue({
      id: 'attachment-1',
      filename: 'notes.txt',
      contentType: 'text/plain',
      scanStatus: 'clean',
    });

    const response = await invoke();

    expect(response.status).toBe(403);
    expect(mocks.ticketAttachmentFindFirst).not.toHaveBeenCalled();
    expect(mocks.getAssetBytes).not.toHaveBeenCalled();
    expect(mocks.logAuditAction).toHaveBeenCalledWith(expect.objectContaining({
      action: 'preview_ticket_attachment',
      targetType: 'SupportTicket',
      eventKind: 'security',
      outcome: 'denied',
    }));
  });

  it('rejects MIME/extension mismatches and integrity failures', async () => {
    const bytes = new TextEncoder().encode('plain text');
    mocks.getAssetBytes.mockResolvedValue(bytes);
    mocks.ticketAttachmentFindFirst.mockResolvedValue({
      id: 'attachment-1',
      filename: 'notes.txt',
      contentType: 'application/pdf',
      sizeBytes: bytes.byteLength,
      sha256: sha256Of(bytes),
      storageKey: 'abc123.txt',
      scanStatus: 'clean',
    });

    expect((await invoke()).status).toBe(415);

    mocks.ticketAttachmentFindFirst.mockResolvedValue({
      id: 'attachment-1',
      filename: 'notes.txt',
      contentType: 'text/plain',
      sizeBytes: bytes.byteLength,
      sha256: '0'.repeat(64),
      storageKey: 'abc123.txt',
      scanStatus: 'clean',
    });
    expect((await invoke()).status).toBe(502);
  });
});
