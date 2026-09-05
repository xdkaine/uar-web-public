import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findDirectCampaign: vi.fn(),
  processCampaigns: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  prisma: { offboardCampaign: { findFirst: mocks.findDirectCampaign } },
}));
vi.mock('@/lib/offboard-campaign', () => ({ processOffboardCampaigns: mocks.processCampaigns }));

import { POST } from './route';

function request(body: Record<string, unknown> = {}) {
  return new NextRequest('https://portal.example.test/api/admin/offboard-campaigns/process', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/offboard-campaigns/process direct authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      admin: { username: 'operator', permissions: new Set(['offboard.manage']) },
      response: null,
    });
    mocks.processCampaigns.mockResolvedValue([]);
  });

  it('denies generic processing when an active direct campaign would be included', async () => {
    mocks.findDirectCampaign.mockResolvedValue({ id: 'campaign-direct' });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.processCampaigns).not.toHaveBeenCalled();
  });

  it('allows the lower privilege only when no direct campaign is in scope', async () => {
    mocks.findDirectCampaign.mockResolvedValue(null);

    const response = await POST(request({ campaignId: 'campaign-verification' }));

    expect(response.status).toBe(200);
    expect(mocks.processCampaigns).toHaveBeenCalledWith(expect.objectContaining({
      campaignId: 'campaign-verification',
      actor: 'operator',
      allowDirect: false,
    }));
  });
});
