import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  permission: vi.fn(),
  transaction: vi.fn(),
  upsert: vi.fn(),
  findFirst: vi.fn(),
  updateMany: vi.fn(),
  findUniqueOrThrow: vi.fn(),
  create: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/rbac/core', () => ({ actorHasPermission: mocks.permission }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    messageTemplateRevision: { findMany: vi.fn() },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { UPDATE_SETTINGS: 'update_settings' },
  AuditCategories: { SETTINGS: 'settings' },
  getIpAddress: vi.fn(() => '127.0.0.1'),
  getUserAgent: vi.fn(() => 'vitest'),
  logAuditAction: mocks.audit,
}));

import { PUT } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ admin: { username: 'admin1' }, response: null });
  mocks.permission.mockReturnValue(true);
  mocks.upsert.mockResolvedValue({});
  mocks.findFirst.mockResolvedValue({
    id: 'draft-1', status: 'draft', version: 1,
    updatedAt: new Date('2026-08-28T10:00:00.000Z'),
  });
  mocks.updateMany.mockResolvedValue({ count: 0 });
  mocks.transaction.mockImplementation((callback) => callback({
    messageTemplate: { upsert: mocks.upsert },
    messageTemplateRevision: {
      findFirst: mocks.findFirst,
      updateMany: mocks.updateMany,
      findUniqueOrThrow: mocks.findUniqueOrThrow,
      create: mocks.create,
    },
  }));
});

describe('message draft optimistic concurrency', () => {
  it('returns 409 when another save wins after the timestamp read', async () => {
    const request = new NextRequest('http://localhost/api/admin/config/messages', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: 'request.rejection_notice',
        subject: 'Access Request Update - Cal Poly Pomona Student SOC',
        body: '<p>Hello {{name}}</p>',
        css: '',
        expectedDraftUpdatedAt: '2026-08-28T10:00:00.000Z',
      }),
    });

    const response = await PUT(request);

    expect(response.status).toBe(409);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'draft-1', status: 'draft' }),
    }));
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('archives the current draft and creates a new immutable revision on save', async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.findFirst
      .mockResolvedValueOnce({
        id: 'draft-1', status: 'draft', version: 1,
        updatedAt: new Date('2026-08-28T10:00:00.000Z'),
      })
      .mockResolvedValueOnce({ version: 1 });
    mocks.create.mockImplementationOnce(({ data }) => Promise.resolve({ id: 'draft-2', ...data }));
    const request = new NextRequest('http://localhost/api/admin/config/messages', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: 'request.rejection_notice',
        subject: 'Access Request Update - Cal Poly Pomona Student SOC',
        body: '<p>Hello {{name}}</p><p>Second saved state</p>',
        css: '',
        expectedDraftUpdatedAt: '2026-08-28T10:00:00.000Z',
      }),
    });

    const response = await PUT(request);
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'draft-1',
        status: 'draft',
        updatedAt: new Date('2026-08-28T10:00:00.000Z'),
      },
      data: { status: 'archived' },
    });
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        templateKey: 'request.rejection_notice',
        version: 2,
        status: 'draft',
        body: '<p>Hello {{name}}</p><p>Second saved state</p>',
      }),
    });
    expect(result.revision).toEqual(expect.objectContaining({ id: 'draft-2', version: 2, status: 'draft' }));
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: 'draft-2', outcome: 'success' }),
      expect.objectContaining({ messageTemplateRevision: expect.any(Object) }),
    );
  });

  it('returns 409 when a first draft is based on a stale published version', async () => {
    mocks.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ version: 3 });
    const request = new NextRequest('http://localhost/api/admin/config/messages', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: 'request.rejection_notice',
        subject: 'Access Request Update - Cal Poly Pomona Student SOC',
        body: '<p>Hello {{name}}</p>',
        css: '',
        expectedPublishedVersion: 2,
      }),
    });

    const response = await PUT(request);

    expect(response.status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('maps a competing first-draft create to 409', async () => {
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error('unique conflict'), { code: 'P2002' }));
    const request = new NextRequest('http://localhost/api/admin/config/messages', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: 'request.rejection_notice',
        subject: 'Access Request Update - Cal Poly Pomona Student SOC',
        body: '<p>Hello {{name}}</p>',
        css: '',
        expectedPublishedVersion: null,
      }),
    });

    const response = await PUT(request);

    expect(response.status).toBe(409);
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
