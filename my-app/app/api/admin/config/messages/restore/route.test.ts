import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  permission: vi.fn(),
  transaction: vi.fn(),
  updateMany: vi.fn(),
  findFirst: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  upsert: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/rbac/core', () => ({ actorHasPermission: mocks.permission }));
vi.mock('@/lib/prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
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
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.findFirst
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ version: 3 })
    .mockResolvedValueOnce({ version: 3 });
  mocks.findUnique.mockResolvedValue({
    templateKey: 'faculty.handoff_message', version: 1, status: 'archived',
    body: 'Stored original body', subject: null, css: '',
  });
  mocks.create.mockImplementation(({ data }) => Promise.resolve({ id: 'draft-4', ...data }));
  mocks.upsert.mockResolvedValue({});
  mocks.transaction.mockImplementation((callback) => callback({
    auditLog: { create: vi.fn().mockResolvedValue({}) },
    messageTemplate: { upsert: mocks.upsert },
    messageTemplateRevision: {
      updateMany: mocks.updateMany,
      findFirst: mocks.findFirst,
      findUnique: mocks.findUnique,
      create: mocks.create,
    },
  }));
});

describe('message revision restore', () => {
  it('restores the built-in original directly as a saved draft', async () => {
    const request = new NextRequest('http://localhost/api/admin/config/messages/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'faculty.handoff_message', original: true, expectedDraftUpdatedAt: null, expectedPublishedVersion: 3 }),
    });

    const response = await POST(request);
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        templateKey: 'faculty.handoff_message',
        status: 'draft',
        body: expect.stringContaining('Please {{actionPhrase}} using the following details'),
        subject: null,
        css: '',
      }),
    });
    expect(result.revision).toEqual(expect.objectContaining({ version: 4, status: 'draft' }));
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ targetId: 'draft-4', outcome: 'success' }),
      expect.objectContaining({ auditLog: expect.any(Object) }),
    );
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  it('restores an archived historical revision as a saved draft', async () => {
    const request = new NextRequest('http://localhost/api/admin/config/messages/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'faculty.handoff_message', version: 1, expectedDraftUpdatedAt: null, expectedPublishedVersion: 3 }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.findUnique).toHaveBeenCalledWith({
      where: { templateKey_version: { templateKey: 'faculty.handoff_message', version: 1 } },
    });
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ body: 'Stored original body', status: 'draft' }),
    });
  });

  it('archives the current draft before restoring another revision', async () => {
    mocks.findFirst.mockReset();
    mocks.findFirst
      .mockResolvedValueOnce({
        id: 'draft-4', version: 4, status: 'draft',
        updatedAt: new Date('2026-08-28T11:00:00.000Z'),
      })
      .mockResolvedValueOnce({ version: 4 });
    const request = new NextRequest('http://localhost/api/admin/config/messages/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: 'faculty.handoff_message', version: 1,
        expectedDraftUpdatedAt: '2026-08-28T11:00:00.000Z',
        expectedPublishedVersion: 3,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'draft-4', status: 'draft',
        updatedAt: new Date('2026-08-28T11:00:00.000Z'),
      },
      data: { status: 'archived' },
    });
  });

  it('rejects a stale restore before replacing another administrator draft', async () => {
    mocks.findFirst.mockReset();
    mocks.findFirst.mockResolvedValueOnce({
      id: 'draft-4', version: 4, status: 'draft',
      updatedAt: new Date('2026-08-28T11:00:00.000Z'),
    });
    const request = new NextRequest('http://localhost/api/admin/config/messages/restore', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        key: 'faculty.handoff_message', original: true,
        expectedDraftUpdatedAt: '2026-08-28T10:00:00.000Z',
        expectedPublishedVersion: 3,
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(409);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
