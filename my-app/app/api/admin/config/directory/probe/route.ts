import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { logAuditAction, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { probeDirectoryPath } from '@/lib/ldap/directory-probe';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const MAX_DN_LENGTH = 400;

/**
 * Read-only directory lookup of a single DN so operators can verify a typed
 * path (search base, group DN, bind DN) before saving it.
 */
export async function POST(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'directory.configure')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await parseJsonWithLimit<{ dn?: unknown }>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    if (typeof body.dn !== 'string' || !body.dn.trim()) {
      return NextResponse.json({ error: 'dn is required' }, { status: 400 });
    }
    if (body.dn.length > MAX_DN_LENGTH) {
      return NextResponse.json({ error: `dn must be at most ${MAX_DN_LENGTH} characters` }, { status: 400 });
    }

    const probe = await probeDirectoryPath(body.dn);

    await logAuditAction({
      action: 'probe_directory_path',
      category: AuditCategories.SETTINGS,
      username: admin.username,
      eventKind: 'read',
      outcome: probe.found ? 'success' : 'failure',
      details: { requestedDn: probe.requestedDn, found: probe.found, kind: probe.kind },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    }).catch(() => undefined);

    return NextResponse.json({ probe });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Error probing directory path:', error);
    return NextResponse.json({ error: 'Failed to probe directory path' }, { status: 500 });
  }
}
