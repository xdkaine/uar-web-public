import { NextRequest, NextResponse } from 'next/server';
import { appLogger } from '@/lib/logger';
import { runGuardedPasswordExpirationScheduler } from '@/lib/password-expiration';

async function processScheduledPasswordExpiration(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get('authorization');

    if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
      appLogger.warn('Unauthorized password expiration scheduler request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    return NextResponse.json({
      success: true,
      scheduler: await runGuardedPasswordExpirationScheduler(),
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
