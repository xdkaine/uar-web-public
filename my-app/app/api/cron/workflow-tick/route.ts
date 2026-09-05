import { NextRequest, NextResponse } from 'next/server';
import { appLogger } from '@/lib/logger';
import { runCronWithObservability } from '@/lib/cron/observability';
import { runFlowTick } from '@/lib/flow/engine';
import { bearerTokenMatches } from '@/lib/timing-safe';
import { drainFlowEventOutbox } from '@/lib/flow/outbox';

/**
 * Workflow tick worker (ADR-0013): drains due FlowTimer rows (Wait nodes) and
 * fires interval-based schedule triggers. Runs late after outages, never
 * double-fires thanks to per-graph event-key idempotency.
 */
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      appLogger.error('CRON_SECRET is not configured; denying workflow tick request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!bearerTokenMatches(authHeader, cronSecret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await runCronWithObservability('workflow-tick', async () => {
      const tick = await runFlowTick();
      const outbox = await drainFlowEventOutbox();
      return {
        itemsProcessed: tick.processed + outbox.processed,
        detail: { processed: tick.processed, outbox },
        response: { ...tick, outbox },
      };
    });
    return NextResponse.json({
      success: true,
      ...result.response,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to run workflow tick';
    appLogger.error('Error running workflow tick', { message });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
