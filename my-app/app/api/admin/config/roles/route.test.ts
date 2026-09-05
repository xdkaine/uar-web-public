import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  checkAdminAuthWithRateLimit: vi.fn(),
  actorHasPermission: vi.fn(),
  roleDefinitionFindMany: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({
  checkAdminAuthWithRateLimit: mocks.checkAdminAuthWithRateLimit,
}));

vi.mock('@/lib/rbac/core', () => ({
  actorHasPermission: mocks.actorHasPermission,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    roleDefinition: {
      findMany: mocks.roleDefinitionFindMany,
    },
  },
}));

import { DELETE, GET, PATCH, PUT } from './route';

const HANDLERS = { PUT, PATCH, DELETE };

function request(method: string) {
  return new NextRequest('https://portal.example.test/api/admin/config/roles', { method });
}

describe('legacy roles config route (read-only per ADR-0015)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'roles-admin' },
      response: null,
    });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.roleDefinitionFindMany.mockResolvedValue([
      {
        key: 'system_administrator',
        name: 'System Administrator',
        description: 'Legacy full administrator',
        permissions: ['settings.manage'],
        adGroupDns: ['CN=Domain Admins'],
        isSystem: true,
      },
    ]);
  });

  it('returns stored rows merged with catalog extras for privileged callers', async () => {
    const response = await GET(request('GET'));
    const body = await response.json();
    const byKey = new Map<string, { key: string; adGroupDns: string[] }>(
      body.roles.map((role: { key: string; adGroupDns: string[] }) => [role.key, role])
    );

    expect(response.status).toBe(200);
    expect(byKey.get('system_administrator')?.adGroupDns).toEqual(['CN=Domain Admins']);
    expect(byKey.get('director')).toMatchObject({ key: 'director', adGroupDns: [] });
    expect(body.permissionCatalog).toHaveProperty('roles.manage');
  });

  it('forbids callers without roles.manage', async () => {
    mocks.actorHasPermission.mockReturnValue(false);

    const response = await GET(request('GET'));

    expect(response.status).toBe(403);
    expect(mocks.roleDefinitionFindMany).not.toHaveBeenCalled();
  });

  it.each(['PUT', 'PATCH', 'DELETE'] as const)('rejects %s with 405 and an Allow header', async (method) => {
    const response = await HANDLERS[method]();

    expect(response.status).toBe(405);
    expect(response.headers.get('Allow')).toBe('GET');
    await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
  });

  it.each(['PUT', 'PATCH', 'DELETE'] as const)(
    '%s never touches the role store or rate-limit auth',
    async (method) => {
      await HANDLERS[method]();

      expect(mocks.roleDefinitionFindMany).not.toHaveBeenCalled();
      expect(mocks.checkAdminAuthWithRateLimit).not.toHaveBeenCalled();
      expect(mocks.actorHasPermission).not.toHaveBeenCalled();
    }
  );
});
