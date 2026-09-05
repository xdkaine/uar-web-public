import { NextRequest, NextResponse } from 'next/server';

import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { encryptPassword } from '@/lib/encryption';
import { prisma } from '@/lib/prisma';
import { actorHasPermission } from '@/lib/rbac/core';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';

const KINDS = new Set(['http_basic', 'bearer', 'secret_header', 'ldap_bind']);

async function access(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) return { response: response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!actorHasPermission(admin, 'automation.manage')) return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { admin };
}

function metadata(row: {
  id: string; name: string; kind: string; username: string | null; headerName: string | null;
  allowedHosts: string[]; enabled: boolean; configVersion: number; updatedAt: Date; updatedBy: string;
}) {
  return { ...row, hasSecret: true };
}

function parseInput(body: Record<string, unknown>, secretRequired: boolean) {
  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 100) : '';
  const kind = typeof body.kind === 'string' && KINDS.has(body.kind) ? body.kind : '';
  const secret = typeof body.secret === 'string' ? body.secret : '';
  const username = typeof body.username === 'string' && body.username.trim() ? body.username.trim().slice(0, 500) : null;
  const headerName = typeof body.headerName === 'string' && body.headerName.trim() ? body.headerName.trim().toLowerCase() : null;
  const hosts = Array.isArray(body.allowedHosts)
    ? body.allowedHosts.filter((host): host is string => typeof host === 'string').map((host) => host.trim().toLowerCase()).filter(Boolean)
    : [];
  const allowedHosts = hosts.filter((host, index) => hosts.indexOf(host) === index);
  if (!name || !kind || allowedHosts.length === 0 || allowedHosts.length > 25) return { error: 'Name, credential type, and 1-25 allowed hosts are required' } as const;
  if (!allowedHosts.every((host) => /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$|^[0-9a-f:]+$/i.test(host) && !host.includes('..'))) {
    return { error: 'Allowed hosts must be exact hostnames or IP addresses; wildcards and URLs are not allowed' } as const;
  }
  if (secretRequired && !secret) return { error: 'Secret value is required' } as const;
  if ((kind === 'http_basic' || kind === 'ldap_bind') && !username) return { error: 'Username or bind DN is required for this credential type' } as const;
  if (kind === 'secret_header' && (!headerName || !/^[a-z0-9-]{1,64}$/.test(headerName))) return { error: 'A valid secret header name is required' } as const;
  return { value: { name, kind, secret, username, headerName, allowedHosts, enabled: body.enabled !== false } } as const;
}

async function audit(request: NextRequest, username: string, operation: string, id: string, name: string) {
  await logAuditAction({
    action: AuditActions.UPDATE_SETTINGS,
    category: AuditCategories.CONFIGURATION,
    username,
    targetId: id,
    targetType: 'MonitorCredential',
    eventKind: 'security',
    outcome: 'success',
    details: { operation, name },
    ipAddress: getIpAddress(request),
    userAgent: getUserAgent(request),
  });
}

export async function GET(request: NextRequest) {
  const auth = await access(request);
  if ('response' in auth) return auth.response;
  const rows = await prisma.monitorCredential.findMany({
    orderBy: [{ enabled: 'desc' }, { name: 'asc' }],
    select: { id: true, name: true, kind: true, username: true, headerName: true, allowedHosts: true, enabled: true, configVersion: true, updatedAt: true, updatedBy: true },
  });
  return NextResponse.json({ credentials: rows.map(metadata) });
}

export async function POST(request: NextRequest) {
  const auth = await access(request);
  if ('response' in auth) return auth.response;
  try {
    const body = await parseJsonWithLimit<Record<string, unknown>>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const parsed = parseInput(body, true);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const created = await prisma.monitorCredential.create({
      data: { ...parsed.value, secret: encryptPassword(parsed.value.secret), createdBy: auth.admin.username, updatedBy: auth.admin.username },
      select: { id: true, name: true, kind: true, username: true, headerName: true, allowedHosts: true, enabled: true, configVersion: true, updatedAt: true, updatedBy: true },
    });
    await audit(request, auth.admin.username, 'create', created.id, created.name);
    return NextResponse.json({ credential: metadata(created) }, { status: 201 });
  } catch (error) {
    if (isJsonBodyError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: 'Could not create monitor credential' }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const auth = await access(request);
  if ('response' in auth) return auth.response;
  try {
    const body = await parseJsonWithLimit<Record<string, unknown>>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    if (typeof body.id !== 'string' || !Number.isInteger(body.expectedConfigVersion)) return NextResponse.json({ error: 'Refresh this credential before editing it' }, { status: 409 });
    const current = await prisma.monitorCredential.findUnique({ where: { id: body.id } });
    if (!current) return NextResponse.json({ error: 'Credential not found' }, { status: 404 });
    const parsed = parseInput(body, false);
    if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const updated = await prisma.monitorCredential.updateMany({
      where: { id: current.id, configVersion: Number(body.expectedConfigVersion) },
      data: {
        name: parsed.value.name, kind: parsed.value.kind, username: parsed.value.username,
        headerName: parsed.value.headerName, allowedHosts: parsed.value.allowedHosts, enabled: parsed.value.enabled,
        ...(parsed.value.secret ? { secret: encryptPassword(parsed.value.secret) } : {}),
        configVersion: { increment: 1 }, updatedBy: auth.admin.username,
      },
    });
    if (updated.count !== 1) return NextResponse.json({ error: 'This credential changed in another session' }, { status: 409 });
    const row = await prisma.monitorCredential.findUniqueOrThrow({ where: { id: current.id }, select: { id: true, name: true, kind: true, username: true, headerName: true, allowedHosts: true, enabled: true, configVersion: true, updatedAt: true, updatedBy: true } });
    await audit(request, auth.admin.username, parsed.value.secret ? 'rotate' : 'update', row.id, row.name);
    return NextResponse.json({ credential: metadata(row) });
  } catch (error) {
    if (isJsonBodyError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: 'Could not update monitor credential' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await access(request);
  if ('response' in auth) return auth.response;
  const id = request.nextUrl.searchParams.get('id');
  const expected = Number(request.nextUrl.searchParams.get('expectedConfigVersion'));
  if (!id || !Number.isInteger(expected)) return NextResponse.json({ error: 'Refresh this credential before removing it' }, { status: 409 });
  const referenced = await prisma.workflowMonitorCheck.count({ where: { config: { path: ['credentialRef'], equals: id } } });
  if (referenced > 0) return NextResponse.json({ error: 'Credential is referenced by a published monitor check; disable it instead' }, { status: 409 });
  const row = await prisma.monitorCredential.findUnique({ where: { id } });
  if (!row) return NextResponse.json({ error: 'Credential not found' }, { status: 404 });
  const removed = await prisma.monitorCredential.deleteMany({ where: { id, configVersion: expected } });
  if (removed.count !== 1) return NextResponse.json({ error: 'This credential changed in another session' }, { status: 409 });
  await audit(request, auth.admin.username, 'delete', row.id, row.name);
  return NextResponse.json({ deleted: true });
}
