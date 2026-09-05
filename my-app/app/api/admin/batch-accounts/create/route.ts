import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';

/**
 * The CSV-specific provisioning implementation was retired because it created
 * directory accounts outside the durable BatchAccountItem/request ledger.
 * Clients must use the canonical batch endpoint so every AD account receives
 * the same request ID, immutable directory evidence, and rollback behavior.
 */
export async function POST(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json(
      { error: 'Unauthorized - Admin access required' },
      { status: 401 }
    );
  }

  if (!actorHasPermission(admin, 'batch.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json(
    {
      error: 'This legacy batch creation endpoint has been retired.',
      code: 'BATCH_ENDPOINT_RETIRED',
      replacement: '/api/admin/batch-accounts',
    },
    {
      status: 410,
      headers: { Link: '</api/admin/batch-accounts>; rel="successor-version"' },
    }
  );
}
