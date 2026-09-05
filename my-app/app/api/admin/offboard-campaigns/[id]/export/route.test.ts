import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  campaignFindUnique: vi.fn(),
  logCount: vi.fn(),
  logFindMany: vi.fn(),
  recipientCount: vi.fn(),
  recipientFindMany: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    offboardCampaign: { findUnique: mocks.campaignFindUnique },
    offboardCampaignLog: { count: mocks.logCount, findMany: mocks.logFindMany },
    offboardCampaignRecipient: { count: mocks.recipientCount, findMany: mocks.recipientFindMany },
  },
}));
vi.mock('@/lib/offboard-campaign', () => ({
  getAccountVerificationMap: vi.fn(async () => new Map()),
  normalizeOffboardIdentifier: (value: string) => value,
}));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { EXPORT_OFFBOARD_CAMPAIGN: 'export' },
  AuditCategories: { OFFBOARD_CAMPAIGN: 'offboard' },
  getIpAddress: vi.fn(),
  getUserAgent: vi.fn(),
  logAuditAction: mocks.audit,
}));

import { GET } from './route';

const params = { params: Promise.resolve({ id: 'campaign-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    admin: { username: 'operator', permissions: new Set(['offboard.manage']) },
    response: null,
  });
  mocks.campaignFindUnique.mockResolvedValue({ id: 'campaign-1' });
  mocks.logCount.mockResolvedValue(0);
  mocks.recipientCount.mockResolvedValue(0);
  mocks.logFindMany.mockResolvedValue([]);
  mocks.recipientFindMany.mockResolvedValue([]);
});

describe('GET /api/admin/offboard-campaigns/[id]/export', () => {
  it.each([
    ['recipients', mocks.recipientCount, mocks.recipientFindMany],
    ['logs', mocks.logCount, mocks.logFindMany],
  ] as const)('refuses a %s export over 5,000 rows', async (type, count, findMany) => {
    count.mockResolvedValue(5_001);

    const response = await GET(
      new NextRequest(`https://portal.example.test/api/admin/offboard-campaigns/campaign-1/export?type=${type}`),
      params
    );

    expect(response.status).toBe(422);
    expect(response.headers.get('cache-control')).toBe('no-store');
    await expect(response.json()).resolves.toMatchObject({
      code: 'EXPORT_FILTER_TOO_BROAD',
      total: 5_001,
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('marks successful operational evidence exports no-store', async () => {
    const response = await GET(
      new NextRequest('https://portal.example.test/api/admin/offboard-campaigns/campaign-1/export?type=recipients'),
      params
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mocks.recipientFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 5_000 }));
  });
});
