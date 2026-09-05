import { NextRequest, NextResponse } from 'next/server';
import { appLogger } from '@/lib/logger';
import { runCronWithObservability } from '@/lib/cron/observability';
import { runDirectoryHealthCycle } from '@/lib/monitoring/dc-probe';
import { bearerTokenMatches } from '@/lib/timing-safe';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      appLogger.error('CRON_SECRET is not configured; denying directory probe request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!bearerTokenMatches(authHeader, cronSecret)) {
      appLogger.warn('Unauthorized cron attempt for directory probe');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await runCronWithObservability('probe-directory', async () => {
      const cycle = await runDirectoryHealthCycle();
      return {
        itemsProcessed: cycle.probe.reachable ? 1 : 0,
        detail: {
          reachable: cycle.probe.reachable,
          target: cycle.probe.target,
          emitted: cycle.emitted ?? null,
          error: cycle.probe.error ?? null,
        },
        response: cycle,
      };
    });
    return NextResponse.json({
      success: true,
      result: result.response,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run directory health cycle';
    appLogger.error('Error running directory health cycle', { message });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
