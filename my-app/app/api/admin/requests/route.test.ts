import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ review: vi.fn(), findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn(), audit: vi.fn() }));
vi.mock('@/lib/adminAuth', () => ({ checkReviewAccessWithRateLimit: mocks.review }));
vi.mock('@/lib/prisma', () => ({ prisma: { accessRequest: { findMany: mocks.findMany, count: mocks.count, groupBy: mocks.groupBy } } }));
vi.mock('@/lib/audit-log', () => ({ AuditActions: { VIEW_REQUESTS_LIST: 'view' }, AuditCategories: { ACCESS_REQUEST: 'request' }, getIpAddress: vi.fn(), getUserAgent: vi.fn(), logAuditAction: mocks.audit }));

import { GET } from './route';
import { GET as exportRequests } from './export/route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.review.mockResolvedValue({ admin: { username: 'reviewer', permissions: new Set(['access_requests.read']) }, response: null });
  mocks.findMany.mockResolvedValue([]);
  mocks.count.mockResolvedValue(0);
  mocks.groupBy.mockResolvedValue([]);
});

describe('GET /api/admin/requests', () => {
  it('uses the normalized filters for the rows, total, and summary', async () => {
    const response = await GET(new NextRequest('https://example.test/api/admin/requests?status=approved&limit=10'));
    expect(response.status).toBe(200);
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [{ status: 'approved' }] },
      take: 11,
      omit: { accountPassword: true, verificationToken: true, verificationTokenHash: true },
    }));
    expect(mocks.count).toHaveBeenCalledWith({ where: { AND: [{ status: 'approved' }] } });
    expect(mocks.count).toHaveBeenCalledWith();
    expect(mocks.groupBy).toHaveBeenCalledTimes(3);
    expect(mocks.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ status: 'approved' }] } }));
  });

  it('returns internal, external, and verified facets instead of placeholder values', async () => {
    mocks.count.mockResolvedValueOnce(7).mockResolvedValueOnce(181);
    mocks.groupBy
      .mockResolvedValueOnce([{ status: 'approved', _count: { _all: 7 } }])
      .mockResolvedValueOnce([
        { isInternal: true, isVerified: true, _count: { _all: 4 } },
        { isInternal: false, isVerified: true, _count: { _all: 2 } },
        { isInternal: false, isVerified: false, _count: { _all: 1 } },
      ])
      .mockResolvedValueOnce([]);

    const response = await GET(new NextRequest('https://example.test/api/admin/requests'));
    await expect(response.json()).resolves.toMatchObject({
      summary: { total: 181, approved: 7, internal: 4, external: 3, verified: 6 },
    });
  });

  it('rejects an unsupported filter and denies an unmapped reviewer', async () => {
    expect((await GET(new NextRequest('https://example.test/api/admin/requests?status=made_up'))).status).toBe(400);
    mocks.review.mockResolvedValue({ admin: { username: 'viewer', permissions: new Set() }, response: null });
    expect((await GET(new NextRequest('https://example.test/api/admin/requests'))).status).toBe(403);
  });

  it('refuses a CSV export that would silently omit records', async () => {
    mocks.count.mockResolvedValue(5_001);
    const response = await exportRequests(new NextRequest('https://example.test/api/admin/requests/export'));
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ code: 'EXPORT_FILTER_TOO_BROAD', total: 5_001 });
  });
});
