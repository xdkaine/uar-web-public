import { NextRequest, NextResponse } from 'next/server';
import { appLogger } from '@/lib/logger';
import { processMassEmailCampaigns } from '@/lib/mass-email';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      appLogger.error('CRON_SECRET is not configured; denying mass email processing request');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (authHeader !== `Bearer ${cronSecret}`) {
      appLogger.warn('Unauthorized cron attempt for mass email processing');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const results = await processMassEmailCampaigns({ actor: 'cron' });
    return NextResponse.json({ success: true, results, timestamp: new Date().toISOString() });
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