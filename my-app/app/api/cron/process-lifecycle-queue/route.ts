import { NextRequest, NextResponse } from 'next/server';
import { runCronWithObservability } from '@/lib/cron/observability';
import { isModuleDisabled } from '@/lib/modules/core';
import { processAllQueuedActions } from '@/lib/lifecycle-processor';
import { processMassEmailCampaigns } from '@/lib/mass-email';
import { appLogger } from '@/lib/logger';
import { runGuardedOffboardScheduler } from '@/lib/offboard-scheduler';
import { bearerTokenMatches } from '@/lib/timing-safe';
import { drainProviderLogoutTasks } from '@/lib/auth/provider-logout-audit';
import { isProductionCloneReadOnly } from '@/lib/clone-safety';

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

    if (!bearerTokenMatches(authHeader, cronSecret)) {
      appLogger.warn('Unauthorized cron attempt for lifecycle queue processing');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (isProductionCloneReadOnly()) {
      appLogger.warn('Lifecycle queue processing is disabled in this production-clone environment');
      return NextResponse.json({
        error: 'Lifecycle queue processing is disabled in this production-clone environment.',
        code: 'CLONE_READ_ONLY',
      }, { status: 409 });
    }

    appLogger.info('Starting lifecycle queue processing via cron');

    // Mass email delivery rides on this scheduler; when the communications
    // module is disabled its portion is skipped and recorded as such.
    const communicationsEnabled = !(await isModuleDisabled('communications'));

    const work = await runCronWithObservability('process-lifecycle-queue', async () => {
      const offboardScheduler = await runGuardedOffboardScheduler();
      const massEmailResults = communicationsEnabled
        ? await processMassEmailCampaigns({ actor: 'cron' })
        : [];
      const providerLogoutDrain = await drainProviderLogoutTasks();
      const results = await processAllQueuedActions();

      const summary = {
        total: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        offboardSchedulerStatus: offboardScheduler.status,
        massEmailCampaigns: massEmailResults.length,
        providerLogoutTasksProcessed: providerLogoutDrain.processed,
        providerLogoutTasksIncomplete: providerLogoutDrain.incomplete + providerLogoutDrain.reconciliationRequired,
        timestamp: new Date().toISOString(),
      };

      appLogger.info('Lifecycle queue processing completed', summary);

      return {
        itemsProcessed: results.length,
        detail: {
          successful: summary.successful,
          failed: summary.failed,
          offboardSchedulerStatus: offboardScheduler.status,
          massEmailCampaignsProcessed: massEmailResults.length,
          providerLogoutDrain,
          communicationsModuleSkipped: !communicationsEnabled,
        },
        response: {
          summary,
          offboardScheduler,
          massEmailResults,
          providerLogoutDrain,
          firstResults: results.slice(0, 10), // Return first 10 for reference
        },
      };
    });

    return NextResponse.json({
      success: true,
      message: `Processed ${work.itemsProcessed ?? 0} lifecycle actions`,
      summary: work.response.summary,
      offboardScheduler: work.response.offboardScheduler,
      massEmailResults: work.response.massEmailResults,
      providerLogoutDrain: work.response.providerLogoutDrain,
      results: work.response.firstResults,
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
