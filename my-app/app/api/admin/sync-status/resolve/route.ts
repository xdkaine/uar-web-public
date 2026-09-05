import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';

/** Compatibility tombstone: stale clients must never manufacture governance records. */
export async function POST(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actorHasPermission(admin, 'sync.read')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json({
    error: 'Sync Status no longer creates or reconnects access requests. Use Account Lifecycle for eligible account operations; an unowned account does not require an access request for deletion.',
    code: 'SYNC_LINKAGE_RETIRED',
  }, { status: 405, headers: { Allow: '' } });
}
