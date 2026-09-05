import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

import { ALL_PERMISSION_KEYS, type PermissionKey } from '@/lib/rbac/permissions';

const mocks = vi.hoisted(() => ({
  checkAdminAuthWithRateLimit: vi.fn(),
  accessRequestFindMany: vi.fn(),
  lifecycleFindMany: vi.fn(),
  vpnFindMany: vi.fn(),
  ticketFindMany: vi.fn(),
  auditFindMany: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({
  checkAdminAuthWithRateLimit: mocks.checkAdminAuthWithRateLimit,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    accessRequest: { findMany: mocks.accessRequestFindMany },
    accountLifecycleAction: { findMany: mocks.lifecycleFindMany },
    vPNAccount: { findMany: mocks.vpnFindMany },
    supportTicket: { findMany: mocks.ticketFindMany },
    auditLog: { findMany: mocks.auditFindMany },
  },
}));

import { GET } from './route';

function authorize(permissions: PermissionKey[]) {
  mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
    admin: {
      username: 'operator',
      roles: new Set<string>(),
      permissions: new Set(permissions),
      viaLegacyAdminFallback: false,
    },
    response: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.accessRequestFindMany.mockResolvedValue([]);
  mocks.lifecycleFindMany.mockResolvedValue([]);
  mocks.vpnFindMany.mockResolvedValue([]);
  mocks.ticketFindMany.mockResolvedValue([]);
  mocks.auditFindMany.mockResolvedValue([]);
});

describe('GET /api/admin/search permission coverage', () => {
  it('rejects an explicitly selected search area the actor cannot read', async () => {
    authorize(['admin.search', 'access_requests.read']);

    const response = await GET(new NextRequest('http://localhost/api/admin/search?q=fixture&type=audit'));

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: 'Your privileges do not include audit search' });
    expect(mocks.auditFindMany).not.toHaveBeenCalled();
  });

  it('searches only authorized areas and reports their availability', async () => {
    authorize(['admin.search', 'access_requests.read']);

    const response = await GET(new NextRequest('http://localhost/api/admin/search?q=fixture&type=all'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.availableSearchTypes).toEqual(['requests']);
    expect(mocks.accessRequestFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.lifecycleFindMany).not.toHaveBeenCalled();
    expect(mocks.vpnFindMany).not.toHaveBeenCalled();
    expect(mocks.ticketFindMany).not.toHaveBeenCalled();
    expect(mocks.auditFindMany).not.toHaveBeenCalled();
  });

  it('makes every search area available to the approved all-privilege baseline', async () => {
    authorize([...ALL_PERMISSION_KEYS]);

    const response = await GET(new NextRequest('http://localhost/api/admin/search?q=fixture&type=all'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.availableSearchTypes).toEqual([
      'requests',
      'lifecycle',
      'vpn',
      'tickets',
      'audit',
    ]);
    expect(mocks.accessRequestFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.lifecycleFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.vpnFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.ticketFindMany).toHaveBeenCalledTimes(1);
    expect(mocks.auditFindMany).toHaveBeenCalledTimes(1);
  });

  it('does not expose database error details in the authenticated response', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    authorize(['admin.search', 'access_requests.read']);
    mocks.accessRequestFindMany.mockRejectedValue(
      new Error('postgresql://operator:secret@database/internal_schema')
    );

    const response = await GET(new NextRequest('http://localhost/api/admin/search?q=fixture&type=requests'));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({ error: 'Failed to perform search' });
    expect(JSON.stringify(body)).not.toContain('secret');
    consoleError.mockRestore();
  });
});
