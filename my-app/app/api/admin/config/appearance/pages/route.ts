import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { validateManagedPageDocument } from '@/lib/appearance-pages';
import { PAGE_APPEARANCE_KEYS } from '@/lib/appearance';
import {
  AuditActions,
  AuditCategories,
  emitAuditActionLog,
  getIpAddress,
  getUserAgent,
  logAuditAction,
  type AuditLogEntry,
} from '@/lib/audit-log';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';
import type { Prisma } from '@prisma/client';

async function authorize(request: NextRequest) {
  const auth = await checkAdminAuthWithRateLimit(request);
  if (!auth.admin || auth.response) return { error: auth.response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!actorHasPermission(auth.admin, 'appearance.manage')) return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  return { admin: auth.admin };
}

export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;
  const revisions = await prisma.managedPageRevision.findMany({
    where: { status: { in: ['draft', 'published'] } },
    orderBy: [{ pageKey: 'asc' }, { version: 'desc' }],
  });
  return NextResponse.json({ revisions });
}

export async function PUT(request: NextRequest) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;
  try {
    const body = await parseJsonWithLimit<{ pageKey?: unknown; document?: unknown; expectedUpdatedAt?: unknown }>(request, MAX_REQUEST_BODY_SIZE.LARGE);
    if (!Object.hasOwn(body, 'expectedUpdatedAt') || (body.expectedUpdatedAt !== null && typeof body.expectedUpdatedAt !== 'string')) {
      return NextResponse.json({ error: 'expectedUpdatedAt must be the current draft timestamp or null' }, { status: 400 });
    }
    const validated = validateManagedPageDocument(body.pageKey, body.document);
    let auditEntry: AuditLogEntry | undefined;
    const revision = await prisma.$transaction(async (tx) => {
      const draft = await tx.managedPageRevision.findFirst({ where: { pageKey: validated.pageKey, status: 'draft' }, orderBy: { version: 'desc' } });
      let savedRevision;
      if (draft) {
        if (draft.updatedAt.toISOString() !== body.expectedUpdatedAt) throw new Error('PAGE_DRAFT_CHANGED');
        const update = await tx.managedPageRevision.updateMany({
          where: { id: draft.id, updatedAt: draft.updatedAt, status: 'draft' },
          data: { document: validated.document as unknown as Prisma.InputJsonValue, updatedBy: auth.admin.username },
        });
        if (update.count !== 1) throw new Error('PAGE_DRAFT_CHANGED');
        savedRevision = await tx.managedPageRevision.findUniqueOrThrow({ where: { id: draft.id } });
      } else {
        if (body.expectedUpdatedAt !== null) throw new Error('PAGE_DRAFT_CHANGED');
        const latest = await tx.managedPageRevision.findFirst({ where: { pageKey: validated.pageKey }, orderBy: { version: 'desc' }, select: { version: true } });
        savedRevision = await tx.managedPageRevision.create({ data: { pageKey: validated.pageKey, version: (latest?.version ?? 0) + 1, status: 'draft', document: validated.document as unknown as Prisma.InputJsonValue, createdBy: auth.admin.username, updatedBy: auth.admin.username } });
      }
      auditEntry = { action: AuditActions.UPDATE_SETTINGS, category: AuditCategories.SETTINGS, username: auth.admin.username, targetType: 'ManagedPageRevision', targetId: savedRevision.id, eventKind: 'write', outcome: 'success', details: { pageKey: savedRevision.pageKey, version: savedRevision.version, action: 'save_draft' }, ipAddress: getIpAddress(request), userAgent: getUserAgent(request) };
      await logAuditAction(auditEntry, tx, { emitOperationalLog: false });
      return savedRevision;
    }, { isolationLevel: 'Serializable' });
    if (auditEntry) emitAuditActionLog(auditEntry);
    return NextResponse.json({ revision });
  } catch (error) {
    if (isJsonBodyError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    const errorCode = (error as { code?: string })?.code;
    if ((error instanceof Error && error.message === 'PAGE_DRAFT_CHANGED') || errorCode === 'P2002' || errorCode === 'P2034') return NextResponse.json({ error: 'This page draft changed in another session. Reload before saving.' }, { status: 409 });
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Failed to save page draft' }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if ('error' in auth) return auth.error;
  try {
    const body = await parseJsonWithLimit<{ pageKey?: unknown; action?: unknown; version?: unknown; expectedUpdatedAt?: unknown }>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    if (typeof body.pageKey !== 'string') return NextResponse.json({ error: 'pageKey is required' }, { status: 400 });
    if (!(PAGE_APPEARANCE_KEYS as readonly string[]).includes(body.pageKey)) return NextResponse.json({ error: 'Unknown pageKey' }, { status: 400 });
    if (body.action !== 'publish' && body.action !== 'restore') return NextResponse.json({ error: 'action must be publish or restore' }, { status: 400 });
    if (!Object.hasOwn(body, 'expectedUpdatedAt') || (body.expectedUpdatedAt !== null && typeof body.expectedUpdatedAt !== 'string')) {
      return NextResponse.json({ error: 'expectedUpdatedAt must be the current draft timestamp or null' }, { status: 400 });
    }
    const pageKey = body.pageKey;
    let auditEntry: AuditLogEntry | undefined;
    const revision = await prisma.$transaction(async (tx) => {
      let updatedRevision;
      if (body.action === 'restore') {
        if (!Number.isInteger(body.version)) throw new Error('A version is required to restore');
        const source = await tx.managedPageRevision.findUnique({ where: { pageKey_version: { pageKey, version: Number(body.version) } } });
        if (!source) throw new Error('Page revision not found');
        const draft = await tx.managedPageRevision.findFirst({ where: { pageKey, status: 'draft' }, orderBy: { version: 'desc' } });
        if (draft) {
          if (draft.updatedAt.toISOString() !== body.expectedUpdatedAt) throw new Error('PAGE_DRAFT_CHANGED');
          const deleted = await tx.managedPageRevision.deleteMany({ where: { id: draft.id, status: 'draft', updatedAt: draft.updatedAt } });
          if (deleted.count !== 1) throw new Error('PAGE_DRAFT_CHANGED');
        } else if (body.expectedUpdatedAt !== null) {
          throw new Error('PAGE_DRAFT_CHANGED');
        }
        const latest = await tx.managedPageRevision.findFirst({ where: { pageKey }, orderBy: { version: 'desc' }, select: { version: true } });
        updatedRevision = await tx.managedPageRevision.create({ data: { pageKey, version: (latest?.version ?? 0) + 1, status: 'draft', document: source.document as Prisma.InputJsonValue, createdBy: auth.admin.username, updatedBy: auth.admin.username } });
      } else {
        const draft = await tx.managedPageRevision.findFirst({ where: { pageKey, status: 'draft' }, orderBy: { version: 'desc' } });
        if (!draft) throw new Error('Save a page draft before publishing');
        if (draft.updatedAt.toISOString() !== body.expectedUpdatedAt) throw new Error('PAGE_DRAFT_CHANGED');
        await tx.managedPageRevision.updateMany({ where: { pageKey, status: 'published' }, data: { status: 'archived' } });
        const update = await tx.managedPageRevision.updateMany({ where: { id: draft.id, updatedAt: draft.updatedAt, status: 'draft' }, data: { status: 'published', publishedAt: new Date(), publishedBy: auth.admin.username, updatedBy: auth.admin.username } });
        if (update.count !== 1) throw new Error('PAGE_DRAFT_CHANGED');
        updatedRevision = await tx.managedPageRevision.findUniqueOrThrow({ where: { id: draft.id } });
      }
      auditEntry = { action: AuditActions.UPDATE_SETTINGS, category: AuditCategories.SETTINGS, username: auth.admin.username, targetType: 'ManagedPageRevision', targetId: updatedRevision.id, eventKind: 'write', outcome: 'success', details: { pageKey: updatedRevision.pageKey, version: updatedRevision.version, action: body.action }, ipAddress: getIpAddress(request), userAgent: getUserAgent(request) };
      await logAuditAction(auditEntry, tx, { emitOperationalLog: false });
      return updatedRevision;
    }, { isolationLevel: 'Serializable' });
    if (auditEntry) emitAuditActionLog(auditEntry);
    return NextResponse.json({ revision });
  } catch (error) {
    if (isJsonBodyError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    const message = error instanceof Error ? error.message : 'Failed to update page revision';
    const errorCode = (error as { code?: string })?.code;
    const conflict = message === 'PAGE_DRAFT_CHANGED' || errorCode === 'P2002' || errorCode === 'P2034';
    return NextResponse.json({ error: conflict ? 'This page draft changed in another session. Reload before publishing.' : message }, { status: conflict ? 409 : 400 });
  }
}
