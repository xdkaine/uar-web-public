import { NextRequest, NextResponse } from 'next/server';

import { runCronWithObservability } from '@/lib/cron/observability';
import { scanOperationalDetectors } from '@/lib/operations/detectors';
import { bearerTokenMatches } from '@/lib/timing-safe';

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerTokenMatches(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await runCronWithObservability('detect-operational-issues', async () => {
      const detectors = await scanOperationalDetectors();
      return {
        itemsProcessed: detectors.overdueJobs + detectors.accessRequests,
        detail: { detectors },
        response: detectors,
      };
    });
    return NextResponse.json({ success: true, ...result.response });
  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Operational detector scan failed',
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
