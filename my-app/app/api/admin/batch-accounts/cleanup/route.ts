import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';

export async function GET() {
  return NextResponse.json(
    { error: 'Method not allowed' },
    {
      status: 405,
      headers: { Allow: 'POST' },
    }
  );
}

export async function POST(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!actorHasPermission(admin, 'batch.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  return NextResponse.json(
    {
      error: 'Stale batch cleanup is disabled',
      recovery:
        'Use authenticated per-batch cancellation only for durable batches with account items. Legacy CSV batches require manual directory and database reconciliation.',
    },
    { status: 410 }
  );
}
