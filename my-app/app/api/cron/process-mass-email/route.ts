import { NextRequest, NextResponse } from 'next/server';
import { appLogger } from '@/lib/logger';
import { checkCronModuleEnabled, runCronWithObservability } from '@/lib/cron/observability';
import { isModuleEnabled } from '@/lib/modules/core';
import { processMassEmailCampaigns } from '@/lib/mass-email';
import { bearerTokenMatches } from '@/lib/timing-safe';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      appLogger.error('CRON_SECRET is not configured; denying mass email processing request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!bearerTokenMatches(authHeader, cronSecret)) {
      appLogger.warn('Unauthorized cron attempt for mass email processing');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Communications module disabled: record the skip and short-circuit with
    // no external side effects.
    if (!(await checkCronModuleEnabled('process-mass-email', 'communications', () => isModuleEnabled('communications')))) {
      return NextResponse.json({
        success: true,
        skipped: 'communications module disabled',
        results: [],
        timestamp: new Date().toISOString(),
      });
    }

    const work = await runCronWithObservability('process-mass-email', async () => {
      const results = await processMassEmailCampaigns({ actor: 'cron' });
      return { itemsProcessed: results.length, detail: { campaignsProcessed: results.length }, results };
    });
    return NextResponse.json({ success: true, results: work.results, timestamp: new Date().toISOString() });
  } catch (error) {
    appLogger.error('Error processing mass email queue via cron', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to process mass email queue' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}