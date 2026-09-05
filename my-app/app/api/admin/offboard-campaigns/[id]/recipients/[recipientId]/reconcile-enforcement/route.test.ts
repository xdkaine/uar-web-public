import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  findCampaign: vi.fn(),
  reconcile: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  prisma: { offboardCampaign: { findUnique: mocks.findCampaign } },
}));
vi.mock('@/lib/offboard-campaign', () => ({ reconcileOffboardEnforcement: mocks.reconcile }));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { OFFBOARD_ENFORCEMENT_RECONCILED: 'offboard_enforcement_reconciled' },
  AuditCategories: { OFFBOARD_CAMPAIGN: 'offboard_campaign' },
  getIpAddress: vi.fn(),
  getUserAgent: vi.fn(),
  logAuditAction: mocks.audit,
}));

import { POST } from './route';

function request() {
  return new NextRequest('https://portal.example.test/api/admin/offboard-campaigns/campaign-direct/recipients/recipient-1/reconcile-enforcement', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ resolution: 'not_applied', evidence: 'Confirmed no external effects were applied' }),
  });
}

const context = { params: Promise.resolve({ id: 'campaign-direct', recipientId: 'recipient-1' }) };

describe('direct enforcement reconciliation authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findCampaign.mockResolvedValue({ workflowMode: 'direct' });
  });

  it('denies an ordinary offboard manager before accepting reconciliation evidence', async () => {
    mocks.auth.mockResolvedValue({
      admin: { username: 'operator', permissions: new Set(['offboard.manage']) },
      response: null,
    });

    const response = await POST(request(), context);

    expect(response.status).toBe(403);
    expect(mocks.reconcile).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
});
