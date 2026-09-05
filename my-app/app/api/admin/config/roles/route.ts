import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { ROLE_CATALOG } from '@/lib/rbac/catalog';
import { PERMISSIONS, isValidPermissionKey } from '@/lib/rbac/permissions';

export const dynamic = 'force-dynamic';

// ADR-0015 retains RoleDefinition rows read-only and no longer consults them
// for authorization; the legacy write surface was retired so the API cannot
// report success on rows that authorization ignores.
function methodNotAllowed() {
  return NextResponse.json(
    { error: 'Role definitions are retained read-only; map privileges in Privileges & Access instead.' },
    { status: 405, headers: { Allow: 'GET' } }
  );
}

export async function GET(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'roles.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let rows = [];
  try {
    rows = await prisma.roleDefinition.findMany({ orderBy: [{ isSystem: 'desc' }, { key: 'asc' }] });
  } catch (error) {
    console.error('Failed to load role definitions:', error);
    return NextResponse.json({ error: 'Role store unavailable. Run pending migrations.' }, { status: 503 });
  }

  const rowByKey = new Map(rows.map((row) => [row.key, row]));
  // Every catalog role is always visible so a fresh deployment has something
  // to map; stored rows win over catalog defaults when both exist.
  const catalogExtras = ROLE_CATALOG.filter((entry) => !rowByKey.has(entry.key)).map((entry) => ({
    key: entry.key,
    name: entry.name,
    description: entry.description,
    permissions: entry.permissions.filter(isValidPermissionKey),
    adGroupDns: [],
    isSystem: entry.isSystem,
  }));

  return NextResponse.json({
    roles: [...rows, ...catalogExtras].map((role) => ({
      ...role,
      permissions: role.permissions.filter(isValidPermissionKey),
    })),
    permissionCatalog: PERMISSIONS,
  });
}

export async function PUT() {
  return methodNotAllowed();
}

export async function PATCH() {
  return methodNotAllowed();
}

export async function DELETE() {
  return methodNotAllowed();
}
