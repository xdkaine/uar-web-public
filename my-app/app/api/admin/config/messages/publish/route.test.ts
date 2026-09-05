import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  permission: vi.fn(),
  transaction: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  updateTemplate: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/rbac/core', () => ({ actorHasPermission: mocks.permission }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('@/lib/messages/core', () => ({ clearMessageTemplateCache: vi.fn() }));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { UPDATE_SETTINGS: 'update_settings' },
  AuditCategories: { SETTINGS: 'settings' },
  getIpAddress: vi.fn(() => '127.0.0.1'),
  getUserAgent: vi.fn(() => 'vitest'),
  logAuditAction: mocks.audit,
}));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ admin: { username: 'admin1' }, response: null });
  mocks.permission.mockReturnValue(true);
  mocks.findFirst.mockResolvedValue({
    id: 'draft-1', templateKey: 'request.rejection_notice', status: 'draft', version: 2,
    updatedAt: new Date('2026-08-28T10:00:00.000Z'), subject: 'Published subject', body: '<p>Published</p>', css: '',
  });
  mocks.updateMany
    .mockResolvedValueOnce({ count: 1 })
    .mockResolvedValueOnce({ count: 0 });
  mocks.transaction.mockImplementation((callback) => callback({
    messageTemplateRevision: {
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
      findUniqueOrThrow: mocks.findUniqueOrThrow,
    },
    messageTemplate: { update: mocks.updateTemplate },
  }));
});

describe('message publish optimistic concurrency', () => {
  it('publishes and writes the success audit in the same transaction', async () => {
    mocks.updateMany.mockReset();
    mocks.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    mocks.findUniqueOrThrow.mockResolvedValueOnce({
      id: 'draft-1', templateKey: 'request.rejection_notice', status: 'published', version: 2,
      body: '<p>Published</p>', subject: 'Published subject',
    });
    mocks.updateTemplate.mockResolvedValueOnce({});
    const response = await POST(new NextRequest('http://localhost/api/admin/config/messages/publish', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: 'request.rejection_notice',
        expectedDraftUpdatedAt: '2026-08-28T10:00:00.000Z',
      }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: 'draft-1', outcome: 'success' }),
      expect.objectContaining({ messageTemplateRevision: expect.any(Object) }),
    );
  });

  it('returns 409 when a save changes the draft before the publish claim', async () => {
    const request = new NextRequest('http://localhost/api/admin/config/messages/publish', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: 'request.rejection_notice',
        expectedDraftUpdatedAt: '2026-08-28T10:00:00.000Z',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(409);
    expect(mocks.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ id: 'draft-1', status: 'draft' }),
    }));
    expect(mocks.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('blocks an unsafe draft only when it is published', async () => {
    mocks.findFirst.mockResolvedValue({
      id: 'draft-unsafe', templateKey: 'request.verification', status: 'draft', version: 2,
      updatedAt: new Date('2026-08-28T10:00:00.000Z'), subject: 'Verify {{name}}',
      body: '<a href="https://portal.invalid/verify">Verify</a>', css: '',
    });
    const response = await POST(new NextRequest('http://localhost/api/admin/config/messages/publish', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'request.verification', expectedDraftUpdatedAt: '2026-08-28T10:00:00.000Z' }),
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('sample/reserved destination') });
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});
