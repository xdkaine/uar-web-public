import { NextRequest, NextResponse } from 'next/server';

import { purgeExpiredQuarantinedAssets, reconcileStalePendingAttachments } from '@/lib/assets/quarantine';
import { runCronWithObservability } from '@/lib/cron/observability';
import { appLogger } from '@/lib/logger';
import { bearerTokenMatches } from '@/lib/timing-safe';

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || !bearerTokenMatches(request.headers.get('authorization'), cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await runCronWithObservability('purge-attachment-quarantine', async () => {
      const [pending, quarantine] = await Promise.all([
        reconcileStalePendingAttachments(),
        purgeExpiredQuarantinedAssets(),
      ]);
      const outcome = { purged: quarantine.purged, recoveredPending: pending.recovered };
      return { itemsProcessed: outcome.purged + outcome.recoveredPending, detail: outcome, response: outcome };
    });
    return NextResponse.json({ success: true, ...result.response });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Quarantine purge failed';
    appLogger.error('Attachment quarantine purge failed', { message });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return GET(request);
}
