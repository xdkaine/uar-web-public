import { NextRequest, NextResponse } from 'next/server';
import { createHash, randomUUID } from 'crypto';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { getLDAPUserEmail } from '@/lib/ldap';
import { sendMessageTemplateTest } from '@/lib/email';
import { MESSAGE_TEMPLATE_CATALOG } from '@/lib/messages/catalog';
import { renderMessageAuthoringSample } from '@/lib/messages/authoring';
import { prisma } from '@/lib/prisma';
import { checkRateLimitAsync, getClientIp, isRateLimitUnavailable, RateLimitPresets } from '@/lib/ratelimit';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit, validateEmail } from '@/lib/validation';

export async function POST(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actorHasPermission(admin, 'messages.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const body = await parseJsonWithLimit<{
      key?: unknown;
      subject?: unknown;
      body?: unknown;
      css?: unknown;
      recipientMode?: unknown;
      recipient?: unknown;
      expectedDraftUpdatedAt?: unknown;
      expectedPublishedVersion?: unknown;
    }>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    if (typeof body.key !== 'string' || !MESSAGE_TEMPLATE_CATALOG[body.key]) return NextResponse.json({ error: 'A registered template key is required' }, { status: 400 });
    if (typeof body.subject !== 'string' || typeof body.body !== 'string') return NextResponse.json({ error: 'Subject and body are required' }, { status: 400 });
    if (body.subject.length > 300 || body.body.length > 20_000 || (typeof body.css === 'string' && body.css.length > 20_000)) {
      return NextResponse.json({ error: 'Message test content exceeds the allowed size.' }, { status: 400 });
    }
    if (body.css !== undefined && typeof body.css !== 'string') return NextResponse.json({ error: 'CSS must be text' }, { status: 400 });
    if (body.expectedDraftUpdatedAt !== undefined && body.expectedDraftUpdatedAt !== null && typeof body.expectedDraftUpdatedAt !== 'string') {
      return NextResponse.json({ error: 'Draft revision is invalid' }, { status: 400 });
    }
    if (body.expectedPublishedVersion !== undefined && body.expectedPublishedVersion !== null && typeof body.expectedPublishedVersion !== 'number') {
      return NextResponse.json({ error: 'Published revision is invalid' }, { status: 400 });
    }
    const recipientMode = body.recipientMode ?? 'self';
    if (recipientMode !== 'self' && recipientMode !== 'specific') {
      return NextResponse.json({ error: 'Test recipient mode is invalid' }, { status: 400 });
    }
    let specificRecipient: string | null = null;
    if (recipientMode === 'specific') {
      if (typeof body.recipient !== 'string') {
        return NextResponse.json({ error: 'A test recipient email address is required' }, { status: 400 });
      }
      specificRecipient = body.recipient.trim().toLowerCase();
      if (!validateEmail(specificRecipient)) {
        return NextResponse.json({ error: 'Enter a valid test recipient email address' }, { status: 400 });
      }
    }
    try {
      const limit = await checkRateLimitAsync(getClientIp(request), {
        ...RateLimitPresets.messageTemplateTest,
        identifier: `message-template-test:${admin.username}`,
      });
      if (!limit.success) {
        return NextResponse.json({ error: 'Too many message tests. Try again later.' }, { status: 429 });
      }
    } catch (limitError) {
      if (isRateLimitUnavailable(limitError)) {
        return NextResponse.json({ error: 'Message test rate limiting is temporarily unavailable.' }, { status: 503 });
      }
      throw limitError;
    }

    const revisions = await prisma.messageTemplateRevision.findMany({
      where: { templateKey: body.key, status: { in: ['draft', 'published'] } },
      orderBy: { version: 'desc' },
      select: { status: true, version: true, updatedAt: true, subject: true, body: true, css: true },
    });
    const draft = revisions.find((revision) => revision.status === 'draft');
    const published = revisions.find((revision) => revision.status === 'published');
    const expectedDraftUpdatedAt = body.expectedDraftUpdatedAt ?? null;
    const expectedPublishedVersion = body.expectedPublishedVersion ?? null;
    if ((draft?.updatedAt.toISOString() ?? null) !== expectedDraftUpdatedAt || (published?.version ?? null) !== expectedPublishedVersion) {
      return NextResponse.json({ error: 'This message changed in another session. Reload before sending a test.' }, { status: 409 });
    }
    const directoryRecipient = specificRecipient === null
      ? (await getLDAPUserEmail(admin.username))?.trim().toLowerCase() ?? null
      : null;
    const to = specificRecipient ?? directoryRecipient;
    if (!to || !validateEmail(to)) return NextResponse.json({ error: 'Your directory account does not have a verified email address.' }, { status: 409 });

    const definition = MESSAGE_TEMPLATE_CATALOG[body.key];
    const stored = draft ?? published;
    const rendered = renderMessageAuthoringSample({
      definition,
      subject: stored?.subject?.trim() || definition.defaultSubject || definition.label,
      body: definition.subjectOnly ? '' : stored?.body ?? definition.defaultBody ?? '',
      css: stored?.css ?? '',
    });
    const contentHash = createHash('sha256')
      .update(JSON.stringify({ subject: rendered.subject, html: rendered.html, text: rendered.text }))
      .digest('hex');
    const correlationId = randomUUID();
    const auditBase = {
      action: AuditActions.TEST_MASS_EMAIL,
      category: AuditCategories.MASS_EMAIL,
      username: admin.username,
      subjectEmail: to,
      targetType: 'MessageTemplate',
      targetId: body.key,
      eventKind: 'notification' as const,
      correlationId,
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    };
    await logAuditAction({
      ...auditBase,
      outcome: 'pending',
      details: { key: body.key, stage: 'smtp_send_started', diagnostics: rendered.diagnostics, contentHash, expectedDraftUpdatedAt, expectedPublishedVersion },
    });
    let result;
    try {
      result = await sendMessageTemplateTest({
        to,
        subject: `[TEST] ${rendered.subject}`,
        html: rendered.html,
        text: rendered.text,
      });
    } catch (sendError) {
      try {
        await logAuditAction({
          ...auditBase,
          outcome: 'failure',
          details: { key: body.key, stage: 'smtp_send_failed', diagnostics: rendered.diagnostics, contentHash, expectedDraftUpdatedAt, expectedPublishedVersion },
        });
      } catch (auditError) {
        console.error('Failed to audit message template test failure:', auditError);
      }
      throw sendError;
    }
    try {
      await logAuditAction({
        ...auditBase,
        outcome: 'success',
        details: { key: body.key, stage: 'smtp_send_completed', diagnostics: rendered.diagnostics, contentHash, expectedDraftUpdatedAt, expectedPublishedVersion },
      });
    } catch (auditError) {
      // The pending row proves the action was initiated. Do not return a
      // retryable error after SMTP accepted the message and risk duplication.
      console.error('Failed to finalize message template test audit:', auditError);
    }
    return NextResponse.json({ result, recipient: to, diagnostics: rendered.diagnostics, correlationId });
  } catch (error) {
    if (isJsonBodyError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    console.error('Error sending message template test:', error);
    return NextResponse.json({ error: 'Failed to send message test' }, { status: 500 });
  }
}
