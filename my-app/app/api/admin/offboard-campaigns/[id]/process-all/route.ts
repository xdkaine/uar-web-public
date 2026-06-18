import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import {
  previewProcessAllOffboardCampaign,
  processAllOffboardCampaign,
  type ProcessAllOffboardInput,
} from '@/lib/offboard-campaign';
import { isJsonBodyError, parseAdminJson } from '@/lib/admin-json-parser';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    return NextResponse.json({ preview: await previewProcessAllOffboardCampaign(id) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to preview Process All' },
      { status: 500 }
    );
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const { id } = await params;
    const body = await parseAdminJson<ProcessAllOffboardInput>(request);
    const booleanFields: Array<keyof ProcessAllOffboardInput> = [
      'initialEmails',
      'reminders',
      'enforcement',
      'overrideSendingPause',
      'overrideRemindersPause',
      'overrideEnforcementPause',
    ];
    if (booleanFields.some(field => body[field] !== undefined && typeof body[field] !== 'boolean')) {
      return NextResponse.json({ error: 'Process All options must be boolean values' }, { status: 400 });
    }
    if (!body.initialEmails && !body.reminders && !body.enforcement) {
      return NextResponse.json({ error: 'Select at least one work category' }, { status: 400 });
    }

    const result = await processAllOffboardCampaign(id, body, admin.username);
    await logAuditAction({
      action: AuditActions.OFFBOARD_PROCESS_ALL,
      category: AuditCategories.OFFBOARD_CAMPAIGN,
      username: admin.username,
      targetId: id,
      targetType: 'OffboardCampaign',
      details: { input: body, results: result.results },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });
    return NextResponse.json({ ...result, message: 'Process All completed' });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Process All failed' },
      { status: 500 }
    );
  }
}
