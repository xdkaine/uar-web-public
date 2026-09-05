import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
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
    if (!actorHasPermission(admin, 'offboard.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
    if (!actorHasPermission(admin, 'offboard.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const { id } = await params;
    const body = await parseAdminJson<ProcessAllOffboardInput>(request);
    const booleanFields: Array<keyof ProcessAllOffboardInput> = [
      'initialEmails',
      'reminders',
      'enforcement',
      'directOffboarding',
      'overrideSendingPause',
      'overrideRemindersPause',
      'overrideEnforcementPause',
      'overrideExecutionPause',
    ];
    if (booleanFields.some(field => body[field] !== undefined && typeof body[field] !== 'boolean')) {
      return NextResponse.json({ error: 'Process All options must be boolean values' }, { status: 400 });
    }
    if (!body.initialEmails && !body.reminders && !body.enforcement && !body.directOffboarding) {
      return NextResponse.json({ error: 'Select at least one work category' }, { status: 400 });
    }
    const preview = await previewProcessAllOffboardCampaign(id);
    if (preview.workflowMode === 'direct' && !actorHasPermission(admin, 'offboard.execute_direct')) {
      return NextResponse.json({ error: 'Direct offboarding permission is required' }, { status: 403 });
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
    const failed = result.results.initialEmails.failed
      + result.results.reminders.failed
      + result.results.enforcement.failed
      + result.results.directOffboarding.failed
      + result.results.directOffboarding.finalNoticesReconciliationRequired;
    return NextResponse.json({
      ...result,
      success: failed === 0,
      partial: failed > 0,
      message: failed > 0
        ? `Process All completed with ${failed} failed item(s) requiring review`
        : 'Process All completed',
    }, { status: failed > 0 ? 207 : 200 });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    if (error instanceof Error && error.message === 'OFFBOARD_PROCESS_ALL_PREVIEW_STALE') {
      return NextResponse.json(
        { error: 'Campaign recipients changed after the preview. Refresh and review before processing.' },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Process All failed' },
      { status: 500 }
    );
  }
}
