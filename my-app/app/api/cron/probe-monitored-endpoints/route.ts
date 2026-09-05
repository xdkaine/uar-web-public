import { NextRequest, NextResponse } from 'next/server';

import { runCronWithObservability } from '@/lib/cron/observability';
import { runMonitoredEndpointCycle } from '@/lib/monitoring/endpoint-probe';
import { runWorkflowMonitorCycle } from '@/lib/monitoring/workflow-probe';
import { bearerTokenMatches } from '@/lib/timing-safe';

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !bearerTokenMatches(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await runCronWithObservability('probe-monitored-endpoints', async () => {
      const [legacy, workflows] = await Promise.all([
        runMonitoredEndpointCycle(),
        runWorkflowMonitorCycle(),
      ]);
      const outcome = {
        checked: legacy.checked + workflows.checked,
        transitions: legacy.transitions + workflows.transitions,
        legacy,
        workflows,
      };
      return { itemsProcessed: outcome.checked, detail: outcome, response: outcome };
    });
    return NextResponse.json({ success: true, ...result.response });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Probe cycle failed' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) { return GET(request); }
