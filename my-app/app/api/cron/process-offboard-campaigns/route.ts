import { NextRequest, NextResponse } from 'next/server';
import { appLogger } from '@/lib/logger';
import { runGuardedOffboardScheduler } from '@/lib/offboard-scheduler';

async function processScheduledOffboarding(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get('authorization');

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      appLogger.warn('Unauthorized guarded offboard scheduler request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      scheduler: await runGuardedOffboardScheduler(),
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
