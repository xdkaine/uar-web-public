import type { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  checkAdminAuthWithRateLimit: vi.fn(),
  findMany: vi.fn(),
  logAuditAction: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({
  checkAdminAuthWithRateLimit: mocks.checkAdminAuthWithRateLimit,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    accountLifecycleAction: {
      findMany: mocks.findMany,
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    accessRequest: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    vPNAccount: {
      findUnique: vi.fn(),
    },
    accountLifecycleHistory: {
      create: vi.fn(),
    },
  },
}));

vi.mock('@/lib/lifecycle-processor', () => ({
  processLifecycleAction: vi.fn(),
}));

vi.mock('@/lib/audit-log', () => ({
  AuditActions: { CREATE_LIFECYCLE_ACTION: 'create_lifecycle_action' },
  AuditCategories: { USER: 'user' },
  getIpAddress: vi.fn(() => '127.0.0.1'),
  getUserAgent: vi.fn(() => 'vitest'),
  logAuditAction: mocks.logAuditAction,
}));

import { GET } from './route';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
    admin: { username: 'admin1' },
    response: null,
  });
  mocks.findMany.mockResolvedValue([]);
});

describe('GET /api/admin/account-lifecycle', () => {
  it('returns the newest lifecycle actions first so recent offboards remain visible', async () => {
    const response = await GET(new Request('https://example.test/api/admin/account-lifecycle') as NextRequest);

    await expect(response.json()).resolves.toEqual({ actions: [] });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    }));
  });
});
