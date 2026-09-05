import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  checkAdminAuthWithRateLimit: vi.fn(),
  logAuditAction: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({
  checkAdminAuthWithRateLimit: mocks.checkAdminAuthWithRateLimit,
}));

vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.logAuditAction,
  AuditActions: { VIEW_PAGE: 'view_page' },
  getIpAddress: () => '203.0.113.40',
  getUserAgent: () => 'track-view-route-test',
}));

import { POST } from './route';

function track(body: Record<string, unknown>) {
  return new NextRequest('https://portal.example.test/api/admin/track-view', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('track-view telemetry route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'nav-admin' },
      response: null,
    });
    mocks.logAuditAction.mockResolvedValue(undefined);
  });

  it('accepts a known admin navigation id with its registry category', async () => {
    const response = await POST(track({ pageName: 'requests', category: 'access_request' }));

    expect(response.status).toBe(200);
    expect(mocks.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'view_page',
        category: 'access_request',
        details: { pageName: 'requests' },
      })
    );
  });

  it('accepts the legacy composite form sent by AdminRoutePage', async () => {
    const response = await POST(
      track({ pageName: 'Admin Dashboard - requests', category: 'access_request' })
    );

    expect(response.status).toBe(200);
    expect(mocks.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ details: { pageName: 'Admin Dashboard - requests' } })
    );
  });

  it('rejects unknown page identifiers instead of auditing them', async () => {
    const response = await POST(
      track({ pageName: '../../exfil<script>', category: 'navigation' })
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Unknown page identifier' });
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
  });

  it('rejects known ids paired with a forged category', async () => {
    const response = await POST(track({ pageName: 'users', category: 'navigation' }));

    expect(response.status).toBe(400);
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
  });

  it('rejects requests missing required fields', async () => {
    const response = await POST(track({ pageName: 'users' }));

    expect(response.status).toBe(400);
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
  });
});
