import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  permission: vi.fn(),
  findMany: vi.fn(),
  getAllTemplates: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/rbac/core', () => ({ actorHasPermission: mocks.permission }));
vi.mock('@/lib/prisma', () => ({
  prisma: { messageTemplateRevision: { findMany: mocks.findMany } },
}));
vi.mock('@/lib/messages/core', () => ({ getAllMessageTemplates: mocks.getAllTemplates }));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { UPDATE_SETTINGS: 'update_settings' },
  AuditCategories: { SETTINGS: 'settings' },
  getIpAddress: vi.fn(() => '127.0.0.1'),
  getUserAgent: vi.fn(() => 'vitest'),
  logAuditAction: vi.fn(),
}));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ admin: { username: 'admin1' }, response: null });
  mocks.permission.mockReturnValue(true);
  mocks.getAllTemplates.mockResolvedValue([{
    key: 'faculty.handoff_message',
    label: 'Faculty Handoff Message',
    category: 'requests',
    body: 'Current body',
    subject: null,
    subjectOnly: false,
    variables: [],
    customized: true,
    updatedBy: 'admin1',
    updatedAt: '2026-08-28T10:00:00.000Z',
    css: '',
  }]);
  mocks.findMany.mockResolvedValue([
    {
      id: 'published-3', templateKey: 'faculty.handoff_message', version: 3,
      status: 'published', body: 'Current body', subject: null, css: '',
      updatedAt: new Date('2026-08-28T10:00:00.000Z'), updatedBy: 'admin1',
    },
    {
      id: 'original-1', templateKey: 'faculty.handoff_message', version: 1,
      status: 'archived', body: 'Original body', subject: null, css: '',
      updatedAt: new Date('2026-08-28T09:00:00.000Z'), updatedBy: 'migration-seed',
    },
  ]);
});

describe('message revision history', () => {
  it('loads archived revisions so an earlier original can be restored', async () => {
    const response = await GET(new NextRequest('http://localhost/api/admin/config/messages'));
    const result = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith({
      orderBy: [{ templateKey: 'asc' }, { version: 'desc' }],
    });
    expect(result.revisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'original-1', status: 'archived', version: 1 }),
    ]));
  });
});
