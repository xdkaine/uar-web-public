import { NextRequest, NextResponse } from 'next/server';

import { runCronWithObservability } from '@/lib/cron/observability';
import { drainFlowEventOutbox } from '@/lib/flow/outbox';
import { bearerTokenMatches } from '@/lib/timing-safe';

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerTokenMatches(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await runCronWithObservability('drain-flow-outbox', async () => {
      const outcome = await drainFlowEventOutbox();
      return { itemsProcessed: outcome.processed, detail: outcome, response: outcome };
    });
    return NextResponse.json({ success: true, ...result.response });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Outbox drain failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) { return GET(request); }
