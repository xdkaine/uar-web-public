import { NextRequest, NextResponse } from 'next/server';
import { appLogger } from '@/lib/logger';
import { runCronWithObservability } from '@/lib/cron/observability';
import { runGuardedOffboardScheduler } from '@/lib/offboard-scheduler';
import { bearerTokenMatches } from '@/lib/timing-safe';

async function processScheduledOffboarding(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get('authorization');

    if (!cronSecret || !bearerTokenMatches(authHeader, cronSecret)) {
      appLogger.warn('Unauthorized guarded offboard scheduler request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const scheduler = await runCronWithObservability('process-offboard-campaigns', async () => {
      const result = await runGuardedOffboardScheduler();
      const processed = (result as { processed?: unknown }).processed;
      return {
        itemsProcessed: typeof processed === 'number' ? processed : 0,
        detail: {
          status: (result as { status?: string }).status,
        },
        scheduler: result,
      };
    });

    return NextResponse.json({
      success: true,
      scheduler: scheduler.scheduler,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    appLogger.error('Guarded offboard scheduler failed', { error });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Guarded offboard scheduler failed',
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return processScheduledOffboarding(request);
}

export async function POST(request: NextRequest) {
  return processScheduledOffboarding(request);
}
