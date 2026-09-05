import { NextRequest, NextResponse } from 'next/server';
import { checkReviewAccessWithRateLimit } from '@/lib/adminAuth';

/**
 * Compatibility tombstone for the pre-claim faculty handoff endpoint.
 *
 * Sending through this route used SMTP-before-state ordering and could deliver
 * twice under overlap or crash. Callers must use notify-faculty, which owns the
 * durable claim, lease, and delivery_unknown transition.
 */
export async function POST(request: NextRequest) {
  const { admin, response } = await checkReviewAccessWithRateLimit(request);

  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(
    {
      error: 'This endpoint has been retired. Use the claimed faculty-notification workflow.',
      code: 'FACULTY_NOTIFICATION_ENDPOINT_RETIRED',
      replacement: 'notify-faculty',
    },
    { status: 410 }
  );
}
