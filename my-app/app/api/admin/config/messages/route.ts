import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { actorHasPermission } from '@/lib/rbac/core';
import {
  getAllMessageTemplates,
} from '@/lib/messages/core';
import { MESSAGE_TEMPLATE_CATALOG } from '@/lib/messages/catalog';
import { sanitizeMessageTemplateSource } from '@/lib/messages/renderer';
import { resolveMessageEditorCss } from '@/lib/messages/editor-state';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const MAX_TEMPLATE_BODY_LENGTH = 20000;
const MAX_TEMPLATE_SUBJECT_LENGTH = 300;

export async function GET(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'messages.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Both reads are authorized above and neither derives its query from the
  // other, so starting them together avoids making this read-only page wait
  // for two database/cache round trips in sequence.
  const [templates, drafts] = await Promise.all([
    getAllMessageTemplates(),
    prisma.messageTemplateRevision.findMany({
      orderBy: [{ templateKey: 'asc' }, { version: 'desc' }],
    }),
  ]);
  const latestDraft = new Map<string, (typeof drafts)[number]>();
  const latestPublished = new Map<string, (typeof drafts)[number]>();
  for (const revision of drafts) {
    const target = revision.status === 'draft'
      ? latestDraft
      : revision.status === 'published'
        ? latestPublished
        : null;
    if (!target) continue;
    if (!target.has(revision.templateKey)) target.set(revision.templateKey, revision);
  }
  return NextResponse.json({
    templates: templates.map((template) => {
      const draft = latestDraft.get(template.key);
      const published = latestPublished.get(template.key);
      return {
        ...template,
        publishedBody: template.body,
        publishedSubject: template.subject,
        publishedCss: resolveMessageEditorCss({ publishedCss: published?.css, templateCss: template.css }),
        body: draft?.body ?? template.body,
        subject: draft?.subject?.trim() || template.subject,
        css: resolveMessageEditorCss({ draftCss: draft?.css, publishedCss: published?.css, templateCss: template.css }),
        draftVersion: draft?.version ?? null,
        draftUpdatedAt: draft?.updatedAt ?? null,
        publishedVersion: published?.version ?? null,
      };
    }),
    revisions: drafts.map((revision) => ({ id: revision.id, templateKey: revision.templateKey, version: revision.version, status: revision.status, createdAt: revision.createdAt, updatedAt: revision.updatedAt, updatedBy: revision.updatedBy })),
  });
}

export async function PUT(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'messages.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await parseJsonWithLimit<{ key?: unknown; body?: unknown; subject?: unknown; css?: unknown; expectedDraftUpdatedAt?: unknown; expectedPublishedVersion?: unknown }>(
      request,
      MAX_REQUEST_BODY_SIZE.SMALL
    );

    if (typeof body.key !== 'string') {
      return NextResponse.json({ error: 'Template key is required' }, { status: 400 });
    }
    const templateKey = body.key;
    if (body.expectedPublishedVersion !== undefined && body.expectedPublishedVersion !== null && typeof body.expectedPublishedVersion !== 'number') {
      return NextResponse.json({ error: 'Published revision is invalid' }, { status: 400 });
    }

    // Keys must be registered in the catalog; unregistered keys are rejected
    // so the database never becomes untyped content storage.
    const definition = MESSAGE_TEMPLATE_CATALOG[body.key];
    if (!definition) {
      return NextResponse.json({ error: `Unknown message template key: ${body.key}` }, { status: 400 });
    }

    // Subject handling: subject-only templates require one; others may clear
    // it back to the code default with an empty string.
    let subjectValue: string | null = null;
    if (definition.subjectOnly) {
      if (typeof body.subject !== 'string' || !body.subject.trim()) {
        return NextResponse.json({ error: 'Template subject must be non-empty text' }, { status: 400 });
      }
      subjectValue = body.subject.trim();
    } else if (body.subject !== undefined) {
      if (typeof body.subject !== 'string') {
        return NextResponse.json({ error: 'Template subject must be text' }, { status: 400 });
      }
      subjectValue = body.subject.trim() || null;
    }
    if (subjectValue && subjectValue.length > MAX_TEMPLATE_SUBJECT_LENGTH) {
      return NextResponse.json(
        { error: `Template subject exceeds ${MAX_TEMPLATE_SUBJECT_LENGTH} characters` },
        { status: 400 }
      );
    }

    let bodyValue = '';
    if (!definition.subjectOnly) {
      if (typeof body.body !== 'string' || !body.body.trim()) {
        return NextResponse.json({ error: 'Template body must be non-empty text' }, { status: 400 });
      }
      if (body.body.length > MAX_TEMPLATE_BODY_LENGTH) {
        return NextResponse.json(
          { error: `Template body exceeds ${MAX_TEMPLATE_BODY_LENGTH} characters` },
          { status: 400 }
        );
      }
      bodyValue = sanitizeMessageTemplateSource(body.body);
    }
    const cssValue = typeof body.css === 'string' ? body.css.slice(0, 20000) : null;
    const revision = await prisma.$transaction(async (tx) => {
      await tx.messageTemplate.upsert({
        where: { key: templateKey },
        update: {},
        create: {
          key: templateKey, label: definition.label,
          body: definition.subjectOnly ? '' : definition.defaultBody ?? '',
          subject: definition.defaultSubject ?? null,
          updatedBy: admin.username,
        },
      });
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
      const nextRevision = await tx.messageTemplateRevision.create({
        data: {
          templateKey, version: (latest?.version ?? 0) + 1, status: 'draft',
          body: bodyValue, subject: subjectValue, css: cssValue,
          createdBy: admin.username, updatedBy: admin.username,
        },
      });
      await logAuditAction({
        action: AuditActions.UPDATE_SETTINGS,
        category: AuditCategories.SETTINGS,
        username: admin.username,
        targetId: nextRevision.id,
        targetType: 'MessageTemplateRevision',
        eventKind: 'write',
        outcome: 'success',
        details: {
          key: templateKey,
          version: nextRevision.version,
          newLength: nextRevision.body.length,
        },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      }, tx);
      return nextRevision;
    }, { isolationLevel: 'Serializable' });

    return NextResponse.json({ revision });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    const errorCode = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
    if ((error instanceof Error && error.message === 'MESSAGE_DRAFT_CHANGED') || errorCode === 'P2002' || errorCode === 'P2034') {
      return NextResponse.json({ error: 'This draft changed in another session. Reload before saving.' }, { status: 409 });
    }
    console.error('Error updating message template draft:', error);
    return NextResponse.json({ error: 'Failed to update message template' }, { status: 500 });
  }
}
