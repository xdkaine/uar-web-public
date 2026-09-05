import { NextRequest, NextResponse } from 'next/server';

import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { probeWorkflowCheck } from '@/lib/monitoring/workflow-probe';
import { validateWorkflowMonitorCheck } from '@/lib/monitoring/workflow-checks';
import { actorHasPermission } from '@/lib/rbac/core';
import { MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';

export async function POST(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actorHasPermission(admin, 'automation.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const body = await parseJsonWithLimit<Record<string, unknown>>(request, MAX_REQUEST_BODY_SIZE.SMALL);
  const parsed = validateWorkflowMonitorCheck(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const result = await probeWorkflowCheck(parsed.value);
  await logAuditAction({
    action: AuditActions.UPDATE_SETTINGS,
    category: AuditCategories.CONFIGURATION,
    username: admin.username,
    targetType: 'WorkflowMonitorCheck',
    eventKind: 'system',
    outcome: result.reachable ? 'success' : 'failure',
    details: { operation: 'test', name: parsed.value.name, host: parsed.value.host, kind: parsed.value.kind, reachable: result.reachable, error: result.error },
    ipAddress: getIpAddress(request),
    userAgent: getUserAgent(request),
  }).catch(() => undefined);
  return NextResponse.json({ result });
}
