import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { actorHasPermission } from '@/lib/rbac/core';
import { MAX_MONITORED_ENDPOINTS, validateEndpointDraft, type EndpointDraft } from '@/lib/monitoring/endpoint-policy';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';

class MonitoredEndpointLimitError extends Error {}

async function auditTarget(request: NextRequest, username: string, operation: string, target: { id: string; name?: string; host?: string }) {
  await logAuditAction({
    action: AuditActions.UPDATE_SETTINGS,
    category: AuditCategories.CONFIGURATION,
    username,
    targetId: target.id,
    targetType: 'MonitoredEndpoint',
    eventKind: 'write',
    outcome: 'success',
    details: { operation, name: target.name, host: target.host },
    ipAddress: getIpAddress(request),
    userAgent: getUserAgent(request),
  }).catch((error) => console.error('[Monitoring Target] Audit persistence failed:', error));
}

async function requireAutomationAccess(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) return { response: response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!actorHasPermission(admin, 'automation.manage')) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { admin };
}

export async function GET(request: NextRequest) {
  const access = await requireAutomationAccess(request);
  if ('response' in access) return access.response;
  return NextResponse.json({
    targets: await prisma.monitoredEndpoint.findMany({ orderBy: [{ enabled: 'desc' }, { name: 'asc' }] }),
  });
}

export async function POST(request: NextRequest) {
  const access = await requireAutomationAccess(request);
  if ('response' in access) return access.response;
  try {
    const body = await parseJsonWithLimit<EndpointDraft>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const parsed = validateEndpointDraft(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const target = await prisma.$transaction(async (tx) => {
      if (await tx.monitoredEndpoint.count() >= MAX_MONITORED_ENDPOINTS) {
        throw new MonitoredEndpointLimitError();
      }
      return tx.monitoredEndpoint.create({
        data: { ...parsed.value, createdBy: access.admin.username, updatedBy: access.admin.username },
      });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    await auditTarget(request, access.admin.username, 'create', target);
    return NextResponse.json({ target }, { status: 201 });
  } catch (error) {
    if (isJsonBodyError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    if (error instanceof MonitoredEndpointLimitError || (error as { code?: string })?.code === 'P2034') {
      return NextResponse.json({ error: `At most ${MAX_MONITORED_ENDPOINTS} monitoring targets are allowed` }, { status: 409 });
    }
    return NextResponse.json({ error: 'Failed to create monitoring target' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const access = await requireAutomationAccess(request);
  if ('response' in access) return access.response;
  try {
    const body = await parseJsonWithLimit<EndpointDraft & { id?: unknown; expectedConfigVersion?: unknown }>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    if (typeof body.id !== 'string' || !body.id) return NextResponse.json({ error: 'Target id is required' }, { status: 400 });
    if (!Number.isInteger(body.expectedConfigVersion) || Number(body.expectedConfigVersion) < 0) {
      return NextResponse.json({ error: 'Refresh the target before updating it' }, { status: 409 });
    }
    const parsed = validateEndpointDraft(body);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const updated = await prisma.monitoredEndpoint.updateMany({
      where: { id: body.id, configVersion: Number(body.expectedConfigVersion) },
      data: { ...parsed.value, updatedBy: access.admin.username, configVersion: { increment: 1 } },
    });
    if (updated.count !== 1) {
      return NextResponse.json({ error: 'This target changed in another session. Refresh and try again.' }, { status: 409 });
    }
    const target = await prisma.monitoredEndpoint.findUnique({ where: { id: body.id } });
    if (!target) return NextResponse.json({ error: 'Target not found' }, { status: 404 });
    await auditTarget(request, access.admin.username, 'update', target);
    return NextResponse.json({ target });
  } catch (error) {
    if (isJsonBodyError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: 'Failed to update monitoring target' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const access = await requireAutomationAccess(request);
  if ('response' in access) return access.response;
  const id = request.nextUrl.searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'Target id is required' }, { status: 400 });
  const expectedConfigVersion = Number(request.nextUrl.searchParams.get('expectedConfigVersion'));
  if (!Number.isInteger(expectedConfigVersion) || expectedConfigVersion < 0) {
    return NextResponse.json({ error: 'Refresh the target before removing it' }, { status: 409 });
  }
  const target = await prisma.monitoredEndpoint.findUnique({ where: { id } });
  if (!target) return NextResponse.json({ error: 'Target not found' }, { status: 404 });
  const deleted = await prisma.monitoredEndpoint.deleteMany({
    where: { id, configVersion: expectedConfigVersion },
  });
  if (deleted.count !== 1) {
    return NextResponse.json({ error: 'This target changed in another session. Refresh and try again.' }, { status: 409 });
  }
  await auditTarget(request, access.admin.username, 'delete', target);
  return NextResponse.json({ deleted: true });
}
