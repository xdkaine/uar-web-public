import { NextRequest, NextResponse } from 'next/server';
import { appLogger } from '@/lib/logger';
import { runCronWithObservability } from '@/lib/cron/observability';
import { getConfigValue } from '@/lib/config/resolver';
import { runPasswordCleanup } from '@/lib/password-cleanup';
import { bearerTokenMatches } from '@/lib/timing-safe';

async function processPasswordCleanup(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  if (!cronSecret || !bearerTokenMatches(authHeader, cronSecret)) {
    appLogger.warn('Unauthorized password cleanup scheduler request');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Retention days now resolve through persisted configuration with the
  // legacy environment variable as fallback and the same safe default
  // (ADR-0005). Bounds are enforced by the registry validator.
  let retentionDays = 7;
  try {
    retentionDays = await getConfigValue<number>('password.cleanup.retentionDays');
  } catch {
    appLogger.warn('Password cleanup retention configuration unavailable; using default');
  }

  try {
    const cleanup = await runCronWithObservability('process-password-cleanup', async () => {
      const result = await runPasswordCleanup(retentionDays);
      return {
        itemsProcessed: result.totalCleared,
        detail: {
          retentionDays,
          accessRequestsCleared: result.accessRequestsCleared,
          batchAccountsCleared: result.batchAccountsCleared,
        },
      };
    });
    return NextResponse.json({
      success: true,
      cleanup,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    appLogger.error('Password cleanup scheduler failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json(
      { success: false, error: 'Password cleanup failed' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return processPasswordCleanup(request);
}

export async function POST(request: NextRequest) {
  return processPasswordCleanup(request);
}
