import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock('@/lib/adminAuth', () => ({ checkReviewAccessWithRateLimit: mocks.auth }));

import { POST } from './route';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/admin/requests/[id]/send-to-faculty', () => {
  it('returns a compatibility tombstone and performs no delivery or persistence work', async () => {
    mocks.auth.mockResolvedValue({
      admin: {
        username: 'operator',
        permissions: new Set(['access_requests.review.director']),
        roles: new Set(),
        viaLegacyAdminFallback: false,
      },
      response: null,
    });
    const request = new NextRequest(
      'https://portal.example.test/api/admin/requests/request-1/send-to-faculty',
      { method: 'POST' }
    );

    const response = await POST(request);

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toMatchObject({
      code: 'FACULTY_NOTIFICATION_ENDPOINT_RETIRED',
      replacement: 'notify-faculty',
    });
  });
});
