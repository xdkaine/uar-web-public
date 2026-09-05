import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { getMessageTemplate } from '@/lib/messages/core';
import { MESSAGE_TEMPLATE_CATALOG } from '@/lib/messages/catalog';
import { renderMessageAuthoringSample } from '@/lib/messages/authoring';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const MAX_SUBJECT_LENGTH = 300;
const MAX_BODY_LENGTH = 20000;

export async function POST(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'messages.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const payload = await parseJsonWithLimit<{ key?: unknown; subject?: unknown; body?: unknown; css?: unknown }>(
      request,
      MAX_REQUEST_BODY_SIZE.SMALL
    );

    if (typeof payload.key !== 'string') {
      return NextResponse.json({ error: 'Template key is required' }, { status: 400 });
    }

    // Preview renders catalog-declared templates only; unknown keys are
    // rejected the same way the persistence route rejects them.
    const definition = MESSAGE_TEMPLATE_CATALOG[payload.key];
    if (!definition) {
      return NextResponse.json({ error: `Unknown message template key: ${payload.key}` }, { status: 400 });
    }
    if (payload.subject !== undefined && typeof payload.subject !== 'string') {
      return NextResponse.json({ error: 'Template subject must be text' }, { status: 400 });
    }
    if (payload.body !== undefined && typeof payload.body !== 'string') {
      return NextResponse.json({ error: 'Template body must be text' }, { status: 400 });
    }
    if (typeof payload.subject === 'string' && payload.subject.length > MAX_SUBJECT_LENGTH) {
      return NextResponse.json(
        { error: `Template subject exceeds ${MAX_SUBJECT_LENGTH} characters` },
        { status: 400 }
      );
    }
    if (typeof payload.body === 'string' && payload.body.length > MAX_BODY_LENGTH) {
      return NextResponse.json(
        { error: `Template body exceeds ${MAX_BODY_LENGTH} characters` },
        { status: 400 }
      );
    }

    const template = await getMessageTemplate(payload.key);
    const subjectSource =
      payload.subject !== undefined ? payload.subject : template.subject ?? '';
    const bodySource =
      definition.subjectOnly
        ? ''
        : payload.body !== undefined
          ? payload.body
          : template.body;

    return NextResponse.json(renderMessageAuthoringSample({
      definition,
      subject: subjectSource,
      body: bodySource,
      css: typeof payload.css === 'string'
        ? payload.css.slice(0, MAX_BODY_LENGTH)
        : template.css ?? '',
    }));
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Error previewing message template:', error);
    return NextResponse.json({ error: 'Failed to render template preview' }, { status: 500 });
  }
}
