import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import {
  previewOffboardDeadlineExtension,
  type ExtendOffboardCampaignInput,
} from '@/lib/offboard-campaign';
import { isJsonBodyError, parseAdminJson, MAX_REQUEST_BODY_SIZE } from '@/lib/admin-json-parser';

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
    const body = await parseAdminJson<ExtendOffboardCampaignInput>(
      request,
      MAX_REQUEST_BODY_SIZE.MEDIUM
    );
    return NextResponse.json({ preview: await previewOffboardDeadlineExtension(id, body) });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to preview deadline extension' },
      { status: 400 }
    );
  }
}
