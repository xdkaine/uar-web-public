import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { logAuditAction, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { testDirectoryBindAccount } from '@/lib/ldap/connection-test';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const MAX_URL_LENGTH = 400;

/**
 * Verify the configured bind account can authenticate against a directory
 * server AND read the configured search base. The optional url targets a
 * specific domain controller; without one the saved primary is used.
 * Credential values are never echoed back.
 */
export async function POST(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'directory.configure')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  let targetUrl: string | undefined;
  try {
    const body = await parseJsonWithLimit<{ url?: unknown }>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    if (body.url !== undefined) {
      if (typeof body.url !== 'string') {
        return NextResponse.json({ error: 'url must be a string when provided' }, { status: 400 });
      }
      if (body.url.length > MAX_URL_LENGTH) {
        return NextResponse.json({ error: `url must be at most ${MAX_URL_LENGTH} characters` }, { status: 400 });
      }
      targetUrl = body.url;
    }
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    throw error;
  }

  const result = await testDirectoryBindAccount({ url: targetUrl });

  await logAuditAction({
    action: 'test_directory_bind_account',
    category: AuditCategories.SETTINGS,
    username: admin.username,
    eventKind: 'read',
    outcome: result.ok ? 'success' : 'failure',
    details: {
      targetedSavedPrimary: !targetUrl,
      bindOk: result.bindOk,
      searchOk: result.searchOk,
      latencyMs: result.latencyMs ?? null,
      error: result.error ?? null,
    },
    ipAddress: getIpAddress(request),
    userAgent: getUserAgent(request),
  }).catch(() => undefined);

  return NextResponse.json({ result });
}
