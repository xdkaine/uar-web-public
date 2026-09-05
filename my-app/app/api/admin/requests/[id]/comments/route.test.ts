import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  audit: vi.fn(),
  names: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  prisma: { requestComment: { findMany: mocks.findMany, create: mocks.create } },
}));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { ADD_COMMENT: 'add_comment' },
  AuditCategories: { ACCESS_REQUEST: 'access_request' },
  getIpAddress: vi.fn(),
  getUserAgent: vi.fn(),
  logAuditAction: mocks.audit,
}));
vi.mock('@/lib/ldap', () => ({ resolveLDAPUserDisplayNames: mocks.names }));

import { GET, POST } from './route';

const context = { params: Promise.resolve({ id: 'request-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    admin: { username: 'staff1', permissions: new Set(['access_requests.read', 'access_requests.respond']) },
    response: null,
  });
  mocks.findMany.mockResolvedValue([]);
  mocks.names.mockResolvedValue(new Map());
  mocks.create.mockImplementation(async ({ data }) => ({ id: 'comment-1', ...data }));
});

describe('access request comments', () => {
  it('returns resolved display names while retaining stored usernames', async () => {
    mocks.findMany.mockResolvedValue([{ id: 'c1', author: 'staff1', comment: '<p>Note</p>', attachments: [] }]);
    mocks.names.mockResolvedValue(new Map([['staff1', 'Casey Staff']]));

    const response = await GET(new NextRequest('https://example.test/comments'), context);
    await expect(response.json()).resolves.toMatchObject({
      comments: [{ author: 'staff1', authorDisplayName: 'Casey Staff' }],
    });
  });

  it('sanitizes rich text before storing it', async () => {
    const response = await POST(new NextRequest('https://example.test/comments', {
      method: 'POST',
      body: JSON.stringify({ comment: '<p><strong>Useful</strong></p><script>alert(1)</script>' }),
      headers: { 'content-type': 'application/json' },
    }), context);

    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        requestId: 'request-1',
        author: 'staff1',
        comment: '<p><strong>Useful</strong></p>',
      }),
    });
  });

  it('rejects visually empty rich text', async () => {
    const response = await POST(new NextRequest('https://example.test/comments', {
      method: 'POST',
      body: JSON.stringify({ comment: '<p><br></p>' }),
      headers: { 'content-type': 'application/json' },
    }), context);
    expect(response.status).toBe(400);
  });
});
