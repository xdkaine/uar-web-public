import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { actorHasPermission, clearPrivilegeCache, getAllPrivilegeAssignments } from '@/lib/rbac/core';
import { PERMISSIONS, isValidPermissionKey, ALL_PERMISSION_KEYS } from '@/lib/rbac/permissions';
import { findAdminSearchCoverageGaps } from '@/lib/rbac/search-access';
import { isMemberOfAdminGroup } from '@/lib/ldap/admin-groups';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';

export const dynamic = 'force-dynamic';

/**
 * Privilege-first RBAC surface: every code-registered privilege maps directly
 * to AD group DNs. Legacy domain administrators (ldap.adminGroups) and
 * break-glass accounts always hold the full catalog regardless of mappings.
 */
export async function GET(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'roles.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let assignments;
  try {
    assignments = await getAllPrivilegeAssignments();
  } catch (error) {
    console.error('Failed to load privilege assignments:', error);
    return NextResponse.json({ error: 'Privilege store unavailable. Run pending migrations.' }, { status: 503 });
  }

  let legacyAdminGroupDns: string[] = [];
  try {
    const { getConfigValue } = await import('@/lib/config/resolver');
    legacyAdminGroupDns = await getConfigValue<string[]>('ldap.adminGroups');
  } catch (error) {
    console.error('Failed to resolve legacy admin groups for display:', error);
  }

  const assignmentByKey = new Map(assignments.map((row) => [row.permissionKey, row]));
  // Every catalog privilege is always visible so a fresh deployment has
  // something to map; stored assignments win when both exist.
  const privileges = ALL_PERMISSION_KEYS.map((key) => {
    const stored = assignmentByKey.get(key);
    return {
      permissionKey: key,
      description: PERMISSIONS[key],
      adGroupDns: stored?.adGroupDns ?? [],
      updatedBy: stored?.updatedBy ?? null,
      updatedAt: stored?.updatedAt ?? null,
    };
  });

  return NextResponse.json({
    privileges,
    legacyAdminGroupDns,
    operationalGaps: findAdminSearchCoverageGaps(privileges),
  });
}

interface PrivilegeUpdateBody {
  permissionKey?: unknown;
  adGroupDns?: unknown;
}

export async function PUT(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'roles.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await parseJsonWithLimit<PrivilegeUpdateBody>(
      request,
      MAX_REQUEST_BODY_SIZE.SMALL
    );

    if (typeof body.permissionKey !== 'string' || !isValidPermissionKey(body.permissionKey)) {
      return NextResponse.json({ error: 'Unknown privilege key' }, { status: 400 });
    }

    if (
      !Array.isArray(body.adGroupDns) ||
      body.adGroupDns.some((dn) => typeof dn !== 'string')
    ) {
      return NextResponse.json(
        { error: 'adGroupDns must be an array of distinguished name strings' },
        { status: 400 }
      );
    }

    const dns = (body.adGroupDns as string[])
      .map((dn) => dn.trim())
      .filter((dn) => dn.length > 0);

    // Validate every DN through the hardened parser before persisting.
    // An empty list is valid and clears all group mappings for the privilege.
    try {
      for (const dn of dns) {
        isMemberOfAdminGroup([], JSON.stringify([dn]));
      }
    } catch {
      return NextResponse.json(
        { error: 'adGroupDns contains an invalid group distinguished name' },
        { status: 400 }
      );
    }

    const dedupedDns = Array.from(new Set(dns));
    const previous = await prisma.privilegeAssignment.findUnique({
      where: { permissionKey: body.permissionKey },
    });

    const updated = await prisma.privilegeAssignment.upsert({
      where: { permissionKey: body.permissionKey },
      update: { adGroupDns: dedupedDns, updatedBy: admin.username },
      create: {
        permissionKey: body.permissionKey,
        adGroupDns: dedupedDns,
        updatedBy: admin.username,
      },
    });

    clearPrivilegeCache();

    await logAuditAction({
      action: AuditActions.UPDATE_SETTINGS,
      category: AuditCategories.SETTINGS,
      username: admin.username,
      targetId: updated.permissionKey,
      targetType: 'PrivilegeAssignment',
      eventKind: 'write',
      outcome: 'success',
      details: {
        permissionKey: updated.permissionKey,
        previousAdGroupCount: previous?.adGroupDns.length ?? 0,
        newAdGroupCount: updated.adGroupDns.length,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({
      privilege: {
        permissionKey: updated.permissionKey,
        adGroupDns: updated.adGroupDns,
        updatedBy: updated.updatedBy,
        updatedAt: updated.updatedAt,
      },
    });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Error updating privilege assignment:', error);
    return NextResponse.json({ error: 'Failed to update privilege assignment' }, { status: 500 });
  }
}
