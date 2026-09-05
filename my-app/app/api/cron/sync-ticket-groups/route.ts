import { NextRequest, NextResponse } from 'next/server';
import { appLogger } from '@/lib/logger';
import { runCronWithObservability } from '@/lib/cron/observability';
import { runDirectoryGroupSync } from '@/lib/support/directory-sync';
import { bearerTokenMatches } from '@/lib/timing-safe';

// Refresh directory snapshots for allowed ticket groups (ADR-0007).
// Guarded by the shared CRON_SECRET bearer contract like every cron route.
export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      appLogger.error('CRON_SECRET is not configured; denying ticket group sync request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!bearerTokenMatches(authHeader, cronSecret)) {
      appLogger.warn('Unauthorized cron attempt for ticket group sync');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // The sync runs exactly once, inside the observability wrapper; its
    // outcome is echoed back for operator reference.
    const work = await runCronWithObservability('sync-ticket-groups', async () => {
      const outcome = await runDirectoryGroupSync({ triggeredBy: 'cron' });
      return {
        itemsProcessed: outcome.groupsProcessed,
        detail: {
          status: outcome.status,
          membersCaptured: outcome.membersCaptured,
          errorCount: Array.isArray(outcome.errors) ? outcome.errors.length : 0,
        },
        response: { outcome },
      };
    });
    return NextResponse.json({
      success: true,
      outcome: work.response.outcome,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to sync ticket groups';
    appLogger.error('Error syncing ticket groups via cron', { message });
    const isConflict = message.includes('already running');
    return NextResponse.json(
      { success: false, error: message },
      { status: isConflict ? 409 : 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
