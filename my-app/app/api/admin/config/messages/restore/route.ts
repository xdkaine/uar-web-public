import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { prisma } from '@/lib/prisma';
import { MESSAGE_TEMPLATE_CATALOG } from '@/lib/messages/catalog';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';

export async function POST(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actorHasPermission(admin, 'messages.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  try {
    const body = await parseJsonWithLimit<{ key?: unknown; version?: unknown; original?: unknown; expectedDraftUpdatedAt?: unknown; expectedPublishedVersion?: unknown }>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    if (typeof body.key !== 'string') return NextResponse.json({ error: 'Template key is required' }, { status: 400 });
    const templateKey = body.key;
    const definition = MESSAGE_TEMPLATE_CATALOG[templateKey];
    if (!definition) return NextResponse.json({ error: `Unknown message template key: ${templateKey}` }, { status: 400 });
    const restoreOriginal = body.original === true;
    if (body.original !== undefined && typeof body.original !== 'boolean') return NextResponse.json({ error: 'Original restore flag must be a boolean' }, { status: 400 });
    if (!restoreOriginal && !Number.isInteger(body.version)) return NextResponse.json({ error: 'Template version is required' }, { status: 400 });
    if (body.expectedDraftUpdatedAt !== undefined && body.expectedDraftUpdatedAt !== null && typeof body.expectedDraftUpdatedAt !== 'string') return NextResponse.json({ error: 'Draft revision is invalid' }, { status: 400 });
    if (body.expectedPublishedVersion !== undefined && body.expectedPublishedVersion !== null && typeof body.expectedPublishedVersion !== 'number') return NextResponse.json({ error: 'Published revision is invalid' }, { status: 400 });
    const restored = await prisma.$transaction(async (tx) => {
      await tx.messageTemplate.upsert({
        where: { key: templateKey },
        update: {},
        create: {
          key: templateKey,
          label: definition.label,
          body: definition.subjectOnly ? '' : definition.defaultBody ?? '',
          subject: definition.defaultSubject ?? null,
          updatedBy: admin.username,
        },
      });
      const source = restoreOriginal
        ? {
            subject: definition.defaultSubject ?? null,
            body: definition.subjectOnly ? '' : definition.defaultBody ?? '',
            css: '',
          }
        : await tx.messageTemplateRevision.findUnique({ where: { templateKey_version: { templateKey, version: Number(body.version) } } });
      if (!source) throw new Error('Message revision not found');
      const existingDraft = await tx.messageTemplateRevision.findFirst({
        where: { templateKey, status: 'draft' },
        orderBy: { version: 'desc' },
      });
      if (existingDraft) {
        if (typeof body.expectedDraftUpdatedAt !== 'string' || existingDraft.updatedAt.toISOString() !== body.expectedDraftUpdatedAt) {
          throw new Error('MESSAGE_DRAFT_CHANGED');
        }
        const archived = await tx.messageTemplateRevision.updateMany({
          where: { id: existingDraft.id, status: 'draft', updatedAt: existingDraft.updatedAt },
          data: { status: 'archived' },
        });
        if (archived.count !== 1) throw new Error('MESSAGE_DRAFT_CHANGED');
      } else {
        if (typeof body.expectedDraftUpdatedAt === 'string') throw new Error('MESSAGE_DRAFT_CHANGED');
        const published = await tx.messageTemplateRevision.findFirst({
          where: { templateKey, status: 'published' },
          orderBy: { version: 'desc' },
          select: { version: true },
        });
        if ((published?.version ?? null) !== (body.expectedPublishedVersion ?? null)) {
          throw new Error('MESSAGE_DRAFT_CHANGED');
        }
      }
      const latest = await tx.messageTemplateRevision.findFirst({ where: { templateKey }, orderBy: { version: 'desc' }, select: { version: true } });
      const nextRevision = await tx.messageTemplateRevision.create({ data: { templateKey, version: (latest?.version ?? 0) + 1, status: 'draft', subject: source.subject, body: source.body, css: source.css, createdBy: admin.username, updatedBy: admin.username } });
      await logAuditAction({ action: AuditActions.UPDATE_SETTINGS, category: AuditCategories.SETTINGS, username: admin.username, targetType: 'MessageTemplateRevision', targetId: nextRevision.id, eventKind: 'write', outcome: 'success', details: { key: nextRevision.templateKey, restoredVersion: restoreOriginal ? 'original' : body.version, draftVersion: nextRevision.version }, ipAddress: getIpAddress(request), userAgent: getUserAgent(request) }, tx);
      return nextRevision;
    }, { isolationLevel: 'Serializable' });
    return NextResponse.json({ revision: restored, source: restoreOriginal ? 'original' : 'revision' });
  } catch (error) {
    if (isJsonBodyError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    const errorCode = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
    if ((error instanceof Error && error.message === 'MESSAGE_DRAFT_CHANGED') || errorCode === 'P2002' || errorCode === 'P2034') {
      return NextResponse.json({ error: 'This draft changed in another session. Reload before restoring.' }, { status: 409 });
    }
    if (error instanceof Error && error.message === 'Message revision not found') {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    console.error('Error restoring message template revision:', error);
    return NextResponse.json({ error: 'Failed to restore message revision' }, { status: 500 });
  }
}
