import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findCampaign: vi.fn(),
  createPreview: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  prisma: { offboardCampaign: { findUnique: mocks.findCampaign } },
}));
vi.mock('@/lib/offboard-campaign', () => ({ createOffboardOperationPreview: mocks.createPreview }));

import { POST } from './route';

const request = new NextRequest('https://portal.example.test/api/admin/offboard-campaigns/campaign-direct/rollback-preview', {
  method: 'POST',
});
const context = { params: Promise.resolve({ id: 'campaign-direct' }) };

describe('direct offboarding rollback policy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findCampaign.mockResolvedValue({ workflowMode: 'direct' });
  });

  it('does not disclose direct recovery controls to an ordinary offboard manager', async () => {
    mocks.auth.mockResolvedValue({
      admin: { username: 'operator', permissions: new Set(['offboard.manage']) },
      response: null,
    });

    const response = await POST(request, context);

    expect(response.status).toBe(403);
    expect(mocks.createPreview).not.toHaveBeenCalled();
  });

  it('rejects rollback even for a direct-offboarding operator because access requires a new request', async () => {
    mocks.auth.mockResolvedValue({
      admin: { username: 'operator', permissions: new Set(['offboard.manage', 'offboard.execute_direct']) },
      response: null,
    });

    const response = await POST(request, context);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: expect.stringContaining('new account request') });
    expect(mocks.createPreview).not.toHaveBeenCalled();
  });
});
