import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  checkAdminAuthWithRateLimit: vi.fn(),
  runLockedPasswordExpirationNotifications: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({
  checkAdminAuthWithRateLimit: mocks.checkAdminAuthWithRateLimit,
}));

vi.mock('@/lib/password-expiration', () => ({
  runLockedPasswordExpirationNotifications: mocks.runLockedPasswordExpirationNotifications,
}));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
    admin: { username: 'admin', permissions: new Set(['password_expiration.manage']) },
  });
});

function request(body: unknown) {
  return new NextRequest('https://portal.example.test/api/admin/password-expiration/notify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('password expiration notify route', () => {
  it('rejects an empty selected-user request instead of notifying everyone', async () => {
    const response = await POST(request({ usernames: [] }));
    expect(response.status).toBe(400);
    expect(mocks.runLockedPasswordExpirationNotifications).not.toHaveBeenCalled();
  });

  it('passes an explicit force resend through the locked notification path', async () => {
    mocks.runLockedPasswordExpirationNotifications.mockResolvedValue({
      status: 'processed',
      result: {
        correlationId: 'correlation-1',
        summary: { total: 1, sent: 1, skipped: 0, failed: 0 },
        results: [],
      },
    });

    const response = await POST(request({
      usernames: ['fixture'],
      statuses: ['expired'],
      force: true,
    }));

    expect(response.status).toBe(200);
    expect(mocks.runLockedPasswordExpirationNotifications).toHaveBeenCalledWith({
      actor: 'admin',
      usernames: ['fixture'],
      statuses: ['expired'],
      force: true,
    });
  });

  it('rejects unsupported statuses instead of widening the send', async () => {
    const response = await POST(request({
      usernames: ['fixture'],
      statuses: ['valid'],
    }));

    expect(response.status).toBe(400);
    expect(mocks.runLockedPasswordExpirationNotifications).not.toHaveBeenCalled();
  });
});
