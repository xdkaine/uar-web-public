import { NextRequest, NextResponse } from 'next/server';
import { appLogger } from '@/lib/logger';
import { checkCronModuleEnabled, runCronWithObservability } from '@/lib/cron/observability';
import { isModuleEnabled } from '@/lib/modules/core';
import { runGuardedPasswordExpirationScheduler } from '@/lib/password-expiration';
import { bearerTokenMatches } from '@/lib/timing-safe';

async function processScheduledPasswordExpiration(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get('authorization');

    if (!cronSecret || !bearerTokenMatches(authHeader, cronSecret)) {
      appLogger.warn('Unauthorized password expiration scheduler request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Password expiration module disabled: record the skip and short-circuit
    // without any directory lookups or reminder emails.
    if (!(await checkCronModuleEnabled('process-password-expiration', 'password.expiration', () => isModuleEnabled('password.expiration')))) {
      return NextResponse.json({
        success: true,
        skipped: 'password expiration module disabled',
        scheduler: { status: 'skipped_module_disabled' },
        timestamp: new Date().toISOString(),
      });
    }

    const work = await runCronWithObservability('process-password-expiration', async () => {
      const scheduler = await runGuardedPasswordExpirationScheduler();
      const processed = (scheduler as { processed?: unknown }).processed;
      return {
        itemsProcessed: typeof processed === 'number' ? processed : 0,
        detail: {
          status: (scheduler as { status?: string }).status,
          summary: (scheduler as { result?: { summary?: unknown } }).result?.summary,
        },
        scheduler,
      };
    });

    return NextResponse.json({
      success: true,
      scheduler: work.scheduler,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    appLogger.error('Password expiration scheduler failed', { error });
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Password expiration scheduler failed',
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return processScheduledPasswordExpiration(request);
}

export async function POST(request: NextRequest) {
  return processScheduledPasswordExpiration(request);
}
