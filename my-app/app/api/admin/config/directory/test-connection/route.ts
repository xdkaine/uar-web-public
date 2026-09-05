import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { logAuditAction, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { testDirectoryConnection } from '@/lib/ldap/connection-test';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const MAX_URL_LENGTH = 400;

/**
 * Verify a domain controller endpoint answers TLS + LDAP (rootDSE) before an
 * operator saves it. No credentials are involved.
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
    const body = await parseJsonWithLimit<{ url?: unknown }>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    if (typeof body.url !== 'string' || !body.url.trim()) {
      return NextResponse.json({ error: 'url is required' }, { status: 400 });
    }
    if (body.url.length > MAX_URL_LENGTH) {
      return NextResponse.json({ error: `url must be at most ${MAX_URL_LENGTH} characters` }, { status: 400 });
    }

    const result = await testDirectoryConnection(body.url);

    await logAuditAction({
      action: 'test_directory_connection',
      category: AuditCategories.SETTINGS,
      username: admin.username,
      eventKind: 'read',
      outcome: result.ok ? 'success' : 'failure',
      details: { url: result.url, latencyMs: result.latencyMs ?? null, error: result.error ?? null },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    }).catch(() => undefined);

    return NextResponse.json({ result });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Error testing directory connection:', error);
    return NextResponse.json({ error: 'Failed to test directory connection' }, { status: 500 });
  }
}
