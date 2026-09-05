import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  checkAdminAuthWithRateLimit: vi.fn(),
  updateBatches: vi.fn(),
  updateItems: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({
  checkAdminAuthWithRateLimit: mocks.checkAdminAuthWithRateLimit,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    batchAccountCreation: {
      updateMany: mocks.updateBatches,
    },
    batchAccountItem: {
      updateMany: mocks.updateItems,
    },
  },
}));

type CleanupRoute = {
  GET: () => Promise<Response>;
  POST?: (request: NextRequest) => Promise<Response>;
};

const route = await import('./route') as unknown as CleanupRoute;

function cleanupRequest(): NextRequest {
  return new NextRequest('https://portal.example.test/api/admin/batch-accounts/cleanup', {
    method: 'POST',
  });
}

async function postCleanup(): Promise<Response> {
  expect(route.POST).toBeTypeOf('function');
  if (!route.POST) {
    throw new Error('POST handler is required');
  }

  return route.POST(cleanupRequest());
}

function expectNoBatchMutation() {
  expect(mocks.updateBatches).not.toHaveBeenCalled();
  expect(mocks.updateItems).not.toHaveBeenCalled();
}

describe('retired batch cleanup endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'live-admin', permissions: new Set(['batch.manage']) },
    });
  });

  it('keeps GET side-effect free', async () => {
    const response = await route.GET();

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expectNoBatchMutation();
  });

  it.each([
    ['anonymous', 401],
    ['ordinary user', 403],
  ])('denies an %s POST without touching batch state', async (_label, status) => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValueOnce({
      admin: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status }),
    });

    const response = await postCleanup();

    expect(response.status).toBe(status);
    expectNoBatchMutation();
  });

  it('directs an authenticated administrator to the supported recovery workflow', async () => {
    const response = await postCleanup();
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body).toEqual({
      error: 'Stale batch cleanup is disabled',
      recovery:
        'Use authenticated per-batch cancellation only for durable batches with account items. Legacy CSV batches require manual directory and database reconciliation.',
    });
    expectNoBatchMutation();
  });
});
