import { NextRequest, NextResponse } from 'next/server';
import { processAllQueuedActions } from '@/lib/lifecycle-processor';
import { processMassEmailCampaigns } from '@/lib/mass-email';
import { appLogger } from '@/lib/logger';
import { runGuardedOffboardScheduler } from '@/lib/offboard-scheduler';

/**
 * GET /api/cron/process-lifecycle-queue
 * Cron job to process queued account lifecycle actions
 * 
 * Should be called periodically (e.g., every 5-15 minutes) to process the queue
 */
export async function GET(request: NextRequest) {
  try {
    // Verify this is coming from a cron service or authorized source
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      appLogger.error('CRON_SECRET is not configured; denying lifecycle queue processing request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      appLogger.warn('Unauthorized cron attempt for lifecycle queue processing');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    appLogger.info('Starting lifecycle queue processing via cron');

    const offboardScheduler = await runGuardedOffboardScheduler();
    const massEmailResults = await processMassEmailCampaigns({ actor: 'cron' });
    const results = await processAllQueuedActions();

    const summary = {
      total: results.length,
      successful: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      offboardSchedulerStatus: offboardScheduler.status,
      massEmailCampaigns: massEmailResults.length,
      timestamp: new Date().toISOString(),
    };

    appLogger.info('Lifecycle queue processing completed', summary);

    return NextResponse.json({
      success: true,
      message: `Processed ${results.length} lifecycle actions`,
      summary,
      offboardScheduler,
      massEmailResults,
      results: results.slice(0, 10), // Return first 10 for reference
    });
  } catch (error) {
    appLogger.error('Error in lifecycle queue cron job', { error });
    
    return NextResponse.json(
      { 
        success: false,
        error: error instanceof Error ? error.message : 'Failed to process lifecycle queue' 
      },
      { status: 500 }
    );
  }
}

// Allow POST as well for manual triggering
export async function POST(request: NextRequest) {
  return GET(request);
}
