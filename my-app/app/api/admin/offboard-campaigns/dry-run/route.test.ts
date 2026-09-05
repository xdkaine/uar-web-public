import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  createDryRun: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/offboard-campaign', () => ({ createOffboardDryRun: mocks.createDryRun }));
vi.mock('@/lib/audit-log', () => ({
  AuditActions: { OFFBOARD_DRY_RUN: 'offboard_dry_run' },
  AuditCategories: { OFFBOARD_CAMPAIGN: 'offboard_campaign' },
  getIpAddress: vi.fn(),
  getUserAgent: vi.fn(),
  logAuditAction: mocks.audit,
}));

import { POST } from './route';

function request() {
  return new NextRequest('https://portal.example.test/api/admin/offboard-campaigns/dry-run', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      workflowMode: 'direct',
      directOffboardReason: 'Sponsor confirmed the account holder departed',
      directOffboardReference: 'INC-1234',
      includedUsernames: ['recipient'],
    }),
  });
}

describe('POST /api/admin/offboard-campaigns/dry-run direct mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createDryRun.mockResolvedValue({ id: 'campaign-direct' });
  });

  it('denies offboard managers who lack the default-unmapped direct execution privilege', async () => {
    mocks.auth.mockResolvedValue({
      admin: { username: 'operator', permissions: new Set(['offboard.manage']) },
      response: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
    expect(mocks.createDryRun).not.toHaveBeenCalled();
  });

  it('allows an explicitly privileged operator to create the reviewed direct dry run', async () => {
    mocks.auth.mockResolvedValue({
      admin: { username: 'operator', permissions: new Set(['offboard.manage', 'offboard.execute_direct']) },
      response: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(mocks.createDryRun).toHaveBeenCalledWith(expect.objectContaining({ workflowMode: 'direct' }), 'operator');
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({ workflowMode: 'direct', directOffboardReference: 'INC-1234' }),
    }));
  });
});
