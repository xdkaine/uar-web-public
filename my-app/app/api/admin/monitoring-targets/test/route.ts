import { NextRequest, NextResponse } from 'next/server';

import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { probeEndpoint } from '@/lib/monitoring/endpoint-probe';
import { validateEndpointDraft, type EndpointDraft } from '@/lib/monitoring/endpoint-policy';
import { actorHasPermission } from '@/lib/rbac/core';
import { MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';

export async function POST(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actorHasPermission(admin, 'automation.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await parseJsonWithLimit<EndpointDraft>(request, MAX_REQUEST_BODY_SIZE.SMALL);
  const parsed = validateEndpointDraft(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const result = await probeEndpoint({ id: 'preview', ...parsed.value });
  await logAuditAction({
    action: AuditActions.UPDATE_SETTINGS,
    category: AuditCategories.CONFIGURATION,
    username: admin.username,
    targetType: 'MonitoredEndpoint',
    eventKind: 'system',
    outcome: result.reachable ? 'success' : 'failure',
    details: { operation: 'test', name: parsed.value.name, host: parsed.value.host, protocol: parsed.value.protocol, reachable: result.reachable, error: result.error },
    ipAddress: getIpAddress(request),
    userAgent: getUserAgent(request),
  }).catch((error) => console.error('[Monitoring Target] Probe audit persistence failed:', error));
  return NextResponse.json({ result });
}
