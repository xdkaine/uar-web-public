import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));

import { POST } from './route';

const request = () => new NextRequest(
  'https://portal.example.test/api/admin/batch-accounts/create',
  { method: 'POST' }
);

describe('legacy CSV batch endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({
      admin: { username: 'batch-admin', permissions: new Set(['batch.manage']) },
      response: null,
    });
  });

  it('retires the untracked creation path and identifies the canonical endpoint', async () => {
    const response = await POST(request());

    expect(response.status).toBe(410);
    expect(response.headers.get('link')).toBe('</api/admin/batch-accounts>; rel="successor-version"');
    expect(await response.json()).toEqual({
      error: 'This legacy batch creation endpoint has been retired.',
      code: 'BATCH_ENDPOINT_RETIRED',
      replacement: '/api/admin/batch-accounts',
    });
  });

  it('does not disclose the replacement to unauthorized callers', async () => {
    mocks.auth.mockResolvedValue({
      admin: null,
      response: new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    });

    const response = await POST(request());

    expect(response.status).toBe(401);
  });

  it('requires batch management permission', async () => {
    mocks.auth.mockResolvedValue({
      admin: { username: 'reader', permissions: new Set<string>() },
      response: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(403);
  });
});
