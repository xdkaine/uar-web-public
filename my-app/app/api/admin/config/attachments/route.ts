import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';

import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { clearConfigCache, resolveAllConfig } from '@/lib/config/resolver';
import { getConfigDefinition } from '@/lib/config/registry';
import { prisma } from '@/lib/prisma';
import { actorHasPermission } from '@/lib/rbac/core';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';

const ATTACHMENT_KEYS = [
  'attachments.maxFiles',
  'attachments.maxFileBytes',
  'attachments.maxTicketBytes',
] as const;

async function requireAccess(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) return { response: response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!actorHasPermission(admin, 'tickets.configure')) {
    return { response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { admin };
}

export async function GET(request: NextRequest) {
  const access = await requireAccess(request);
  if ('response' in access) return access.response;
  const entries = await resolveAllConfig();
  return NextResponse.json({
    config: entries.filter((entry) => ATTACHMENT_KEYS.includes(entry.key as typeof ATTACHMENT_KEYS[number])),
  });
}

export async function PUT(request: NextRequest) {
  const access = await requireAccess(request);
  if ('response' in access) return access.response;
  try {
    const body = await parseJsonWithLimit<{ values?: unknown }>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) {
      return NextResponse.json({ error: 'values must be an object' }, { status: 400 });
    }
    const values = Object.entries(body.values as Record<string, unknown>);
    if (values.length === 0 || values.some(([key]) => !ATTACHMENT_KEYS.includes(key as typeof ATTACHMENT_KEYS[number]))) {
      return NextResponse.json({ error: 'Only attachment limit keys may be changed here' }, { status: 400 });
    }

    const validated = values.map(([key, value]) => {
      const parsed = getConfigDefinition(key)!.validate(value);
      if (typeof parsed !== 'number') throw new Error(`${key} must be numeric`);
      return { key, value: parsed };
    });
    const existing = await prisma.systemConfigEntry.findMany({
      where: { key: { in: validated.map(({ key }) => key) } },
      select: { key: true, value: true },
    });
    const previousByKey = new Map(existing.map((entry) => [entry.key, entry.value]));
    await prisma.$transaction([
      ...validated.map(({ key, value }) => prisma.systemConfigEntry.upsert({
        where: { key },
        update: { value, updatedBy: access.admin.username },
        create: { key, value, updatedBy: access.admin.username },
      })),
      ...validated.map(({ key, value }) => prisma.configurationRevision.create({
        data: {
          key,
          previousValue: previousByKey.get(key) ?? Prisma.DbNull,
          newValue: value,
          changeKind: 'update',
          changedBy: access.admin.username,
        },
      })),
    ]);
    clearConfigCache();
    await logAuditAction({
      action: AuditActions.UPDATE_SETTINGS,
      category: AuditCategories.SETTINGS,
      username: access.admin.username,
      targetType: 'SystemConfigEntry',
      eventKind: 'write',
      outcome: 'success',
      details: { changedKeys: validated.map(({ key }) => key) },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });
    return NextResponse.json({ updated: validated.map(({ key }) => key) });
  } catch (error) {
    if (isJsonBodyError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to update limits' }, { status: 400 });
  }
}
