import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { prisma } from '@/lib/prisma';
import { clearMessageTemplateCache } from '@/lib/messages/core';
import { MESSAGE_TEMPLATE_CATALOG } from '@/lib/messages/catalog';
import { validateMessagePublication } from '@/lib/messages/publication-guard';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';

export async function POST(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actorHasPermission(admin, 'messages.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await parseJsonWithLimit<{ key?: unknown; expectedDraftUpdatedAt?: unknown }>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    if (typeof body.key !== 'string') return NextResponse.json({ error: 'Template key is required' }, { status: 400 });
    const templateKey = body.key;
    const definition = MESSAGE_TEMPLATE_CATALOG[templateKey];
    if (!definition) return NextResponse.json({ error: `Unknown message template key: ${templateKey}` }, { status: 400 });

    const published = await prisma.$transaction(async (tx) => {
      const draft = await tx.messageTemplateRevision.findFirst({ where: { templateKey, status: 'draft' }, orderBy: { version: 'desc' } });
      if (!draft) throw new Error('MESSAGE_DRAFT_MISSING');
      if (typeof body.expectedDraftUpdatedAt !== 'string' || draft.updatedAt.toISOString() !== body.expectedDraftUpdatedAt) throw new Error('MESSAGE_DRAFT_CHANGED');
      const publicationErrors = validateMessagePublication({
        definition,
        subject: draft.subject ?? definition.defaultSubject ?? '',
        body: definition.subjectOnly ? '' : draft.body,
        css: draft.css,
      });
      if (publicationErrors.length > 0) throw new Error(`MESSAGE_PUBLICATION_INVALID:${publicationErrors.join('; ')}`);
      await tx.messageTemplateRevision.updateMany({ where: { templateKey, status: 'published' }, data: { status: 'archived' } });
      const transitioned = await tx.messageTemplateRevision.updateMany({
        where: { id: draft.id, status: 'draft', updatedAt: draft.updatedAt },
        data: { status: 'published', publishedAt: new Date(), publishedBy: admin.username, updatedBy: admin.username },
      });
      if (transitioned.count !== 1) throw new Error('MESSAGE_DRAFT_CHANGED');
      const revision = await tx.messageTemplateRevision.findUniqueOrThrow({ where: { id: draft.id } });
      await tx.messageTemplate.update({ where: { key: templateKey }, data: { body: revision.body, subject: revision.subject, updatedBy: admin.username } });
      await logAuditAction({
        action: AuditActions.UPDATE_SETTINGS, category: AuditCategories.SETTINGS, username: admin.username,
        targetId: revision.id, targetType: 'MessageTemplateRevision', eventKind: 'write', outcome: 'success',
        details: { key: revision.templateKey, version: revision.version, transition: 'draft_to_published' },
        ipAddress: getIpAddress(request), userAgent: getUserAgent(request),
      }, tx);
      return revision;
    });

    clearMessageTemplateCache();
    return NextResponse.json({ revision: published });
  } catch (error) {
    if (isJsonBodyError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    if (error instanceof Error && error.message === 'MESSAGE_DRAFT_MISSING') return NextResponse.json({ error: 'Save a draft before publishing.' }, { status: 409 });
    if (error instanceof Error && error.message === 'MESSAGE_DRAFT_CHANGED') return NextResponse.json({ error: 'This draft changed in another session. Reload before publishing.' }, { status: 409 });
    if (error instanceof Error && error.message.startsWith('MESSAGE_PUBLICATION_INVALID:')) {
      return NextResponse.json({ error: error.message.slice('MESSAGE_PUBLICATION_INVALID:'.length) }, { status: 400 });
    }
    console.error('Error publishing message template:', error);
    return NextResponse.json({ error: 'Failed to publish message template' }, { status: 500 });
  }
}
