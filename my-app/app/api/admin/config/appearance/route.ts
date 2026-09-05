import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import {
  emitAuditActionLog,
  logAuditAction,
  AuditActions,
  AuditCategories,
  getIpAddress,
  getUserAgent,
  type AuditLogEntry,
} from '@/lib/audit-log';
import { actorHasPermission } from '@/lib/rbac/core';
import { clearConfigCache, getConfigValue } from '@/lib/config/resolver';
import { normalizeRevisionReason } from '@/lib/config/revisions';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';
import {
  validateNavLinks,
  PAGE_APPEARANCE_KEYS,
  PAGE_APPEARANCE_IDS,
  PAGE_APPEARANCE_REGISTRY,
  validateRegisteredPageContent,
  validateAppearanceTheme,
} from '@/lib/appearance';

export const dynamic = 'force-dynamic';

const APPEARANCE_KEYS = ['appearance.theme', 'nav.links', ...PAGE_APPEARANCE_KEYS] as const;

/** Read current appearance overrides (empty string = built-in defaults). */
export async function GET(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'appearance.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [themeRaw, navRaw, ...pageRawValues] = await Promise.all([
    getConfigValue<string>('appearance.theme').catch(() => ''),
    getConfigValue<string>('nav.links').catch(() => ''),
    ...PAGE_APPEARANCE_IDS.map((id) => getConfigValue<string>(PAGE_APPEARANCE_REGISTRY[id].key).catch(() => '')),
  ]);

  const values = Object.fromEntries(PAGE_APPEARANCE_IDS.map((id, index) => [PAGE_APPEARANCE_REGISTRY[id].key, pageRawValues[index] ?? '']));
  const revisions = await prisma.configurationRevision.findMany({
    where: { key: { in: [...PAGE_APPEARANCE_KEYS] } },
    orderBy: { createdAt: 'desc' },
    take: 30,
    select: { id: true, key: true, createdAt: true, changedBy: true, changeKind: true, newValue: true },
  });
  return NextResponse.json({ 'appearance.theme': themeRaw, 'nav.links': navRaw, ...values, revisions });
}

interface AppearanceWriteBody {
  values?: Record<string, string | null>;
  reason?: unknown;
}

/** Save or clear (null) appearance keys; every change lands in config revisions. */
export async function PUT(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'appearance.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await parseJsonWithLimit<AppearanceWriteBody>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const values = body.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      return NextResponse.json({ error: 'values must be an object of key -> value' }, { status: 400 });
    }

    const entries = Object.entries(values);
    // Validate every document before opening the write transaction.
    for (const [key, rawValue] of entries) {
      if (!(APPEARANCE_KEYS as readonly string[]).includes(key)) {
        return NextResponse.json({ error: `Unknown appearance key "${key}"` }, { status: 400 });
      }
      if (rawValue !== null && typeof rawValue !== 'string') {
        return NextResponse.json({ error: `${key} must be a JSON string or null` }, { status: 400 });
      }
      if (rawValue !== null && rawValue.length > 20000) {
        return NextResponse.json({ error: `${key} exceeds the 20k character limit` }, { status: 400 });
      }
      if (rawValue !== null && rawValue.trim() !== '') {
        try {
          const parsed = JSON.parse(rawValue);
          if (key === 'nav.links') validateNavLinks(parsed);
          else if (key === 'appearance.theme') validateAppearanceTheme(parsed);
          else validateRegisteredPageContent(key, parsed);
        } catch (validationError) {
          const message = validationError instanceof Error ? validationError.message : 'invalid value';
          return NextResponse.json({ error: `${key}: ${message}` }, { status: 400 });
        }
      }
    }

    const changedKeys: string[] = [];
    const reason = normalizeRevisionReason(body.reason);
    const auditEntry: AuditLogEntry = {
      action: AuditActions.UPDATE_SETTINGS,
      category: AuditCategories.SETTINGS,
      username: admin.username,
      targetType: 'SystemConfigEntry',
      eventKind: 'write',
      outcome: 'success',
      details: { changedKeys },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    };
    await prisma.$transaction(async (tx) => {
      for (const [key, rawValue] of entries) {
        const existing = await tx.systemConfigEntry.findUnique({ where: { key } });
        const clearing = rawValue === null || rawValue.trim() === '';
        if (clearing && !existing) continue;
        if (clearing) await tx.systemConfigEntry.delete({ where: { key } });
        else await tx.systemConfigEntry.upsert({
          where: { key },
          update: { value: rawValue, updatedBy: admin.username },
          create: { key, value: rawValue, updatedBy: admin.username },
        });
        changedKeys.push(key);
        await tx.configurationRevision.create({
          data: {
            key,
            previousValue: existing?.value ?? undefined,
            newValue: clearing ? undefined : rawValue,
            changeKind: clearing ? 'clear' : 'update',
            changedBy: admin.username,
            reason,
          },
        });
      }
      await logAuditAction(auditEntry, tx, { emitOperationalLog: false });
    });

    clearConfigCache();
    emitAuditActionLog(auditEntry);

    return NextResponse.json({ updated: changedKeys });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Error saving appearance configuration:', error);
    return NextResponse.json({ error: 'Failed to save appearance configuration' }, { status: 500 });
  }
}

/** Republish a prior page snapshot as a new auditable revision. */
export async function POST(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actorHasPermission(admin, 'appearance.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await parseJsonWithLimit<{ revisionId?: unknown }>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    if (typeof body.revisionId !== 'string') return NextResponse.json({ error: 'revisionId is required' }, { status: 400 });
    const revision = await prisma.configurationRevision.findUnique({ where: { id: body.revisionId } });
    if (!revision || !PAGE_APPEARANCE_KEYS.includes(revision.key as (typeof PAGE_APPEARANCE_KEYS)[number])) {
      return NextResponse.json({ error: 'Page revision not found' }, { status: 404 });
    }
    const targetValue = revision.newValue;
    if (targetValue !== null && typeof targetValue !== 'string') {
      return NextResponse.json({ error: 'This legacy revision cannot be restored safely' }, { status: 409 });
    }
    if (typeof targetValue === 'string') validateRegisteredPageContent(revision.key, JSON.parse(targetValue));
    const auditEntry: AuditLogEntry = {
      action: AuditActions.UPDATE_SETTINGS,
      category: AuditCategories.SETTINGS,
      username: admin.username,
      targetType: 'SystemConfigEntry',
      eventKind: 'write',
      outcome: 'success',
      details: { restoredRevisionId: revision.id, key: revision.key },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    };
    await prisma.$transaction(async (tx) => {
      const existing = await tx.systemConfigEntry.findUnique({ where: { key: revision.key } });
      if (targetValue === null) await tx.systemConfigEntry.deleteMany({ where: { key: revision.key } });
      else await tx.systemConfigEntry.upsert({
        where: { key: revision.key },
        update: { value: targetValue, updatedBy: admin.username },
        create: { key: revision.key, value: targetValue, updatedBy: admin.username },
      });
      await tx.configurationRevision.create({
        data: {
          key: revision.key,
          previousValue: existing?.value ?? undefined,
          newValue: targetValue ?? undefined,
          changeKind: targetValue === null ? 'clear' : 'update',
          changedBy: admin.username,
          reason: `Restored revision ${revision.id}`,
        },
      });
      await logAuditAction(auditEntry, tx, { emitOperationalLog: false });
    });
    clearConfigCache();
    emitAuditActionLog(auditEntry);
    const pageId = PAGE_APPEARANCE_IDS.find((id) => PAGE_APPEARANCE_REGISTRY[id].key === revision.key);
    const expected = targetValue && targetValue.trim()
      ? JSON.parse(targetValue)
      : pageId
        ? PAGE_APPEARANCE_REGISTRY[pageId].defaultContent
        : null;
    return NextResponse.json({ restored: revision.key, pageId, expected });
  } catch (error) {
    if (isJsonBodyError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    console.error('Error restoring appearance revision:', error);
    return NextResponse.json({ error: 'Failed to restore page revision' }, { status: 500 });
  }
}
