import { prisma } from '@/lib/prisma';
import {
  MESSAGE_TEMPLATE_CATALOG,
  isKnownMessageTemplateKey,
  type MessageTemplateKey,
} from './catalog';
import { renderMessageDocument } from './renderer';

export interface ResolvedMessageTemplate {
  key: MessageTemplateKey;
  label: string;
  category: string;
  body: string;
  css: string | null;
  /** Resolved subject line; null when the code fully owns the subject. */
  subject: string | null;
  subjectOnly: boolean;
  variables: Array<{ name: string; description: string }>;
  /** True when content comes from the database rather than the code default. */
  customized: boolean;
  updatedBy: string | null;
  updatedAt: Date | null;
}

interface StoredTemplate {
  body: string;
  subject?: string | null;
  css?: string | null;
  updatedBy: string | null;
  updatedAt: Date;
}

let cachedTemplates: Map<string, StoredTemplate> | null = null;
let lastFetchTime = 0;
const CACHE_TTL = 30000;

function defaults(): Map<string, StoredTemplate> {
  return new Map();
}

async function loadTemplates(): Promise<Map<string, StoredTemplate>> {
  try {
    const rows = await prisma.messageTemplate.findMany({
      include: {
        revisions: {
          where: { status: 'published' },
          orderBy: { version: 'desc' },
          take: 1,
          select: { css: true },
        },
      },
    });
    cachedTemplates = new Map(
      rows.map((row) => [
        row.key,
        {
          body: row.body,
          subject: row.subject ?? null,
          css: row.revisions?.[0]?.css ?? null,
          updatedBy: row.updatedBy,
          updatedAt: row.updatedAt,
        },
      ])
    );
    lastFetchTime = Date.now();
    return cachedTemplates;
  } catch (error) {
    console.error('[Messages] Failed to load templates, using defaults:', error);
    return defaults();
  }
}

async function resolveCache() {
  if (cachedTemplates && Date.now() - lastFetchTime < CACHE_TTL) {
    return cachedTemplates;
  }
  return loadTemplates();
}

export function clearMessageTemplateCache(): void {
  cachedTemplates = null;
  lastFetchTime = 0;
}

/** Resolve a template: stored content when present, exact default otherwise. */
export async function getMessageTemplate(key: MessageTemplateKey): Promise<ResolvedMessageTemplate> {
  const definition = MESSAGE_TEMPLATE_CATALOG[key];
  const store = await resolveCache();
  const stored = store.get(key);

  const subject = stored?.subject?.trim() || definition.defaultSubject || null;
  const body = definition.subjectOnly ? '' : stored?.body ?? definition.defaultBody ?? '';
  const customized =
    (!!stored && (stored.body !== (definition.defaultBody ?? '') || (stored.subject ?? null) !== (definition.defaultSubject ?? null))) ||
    false;

  return {
    key,
    label: definition.label,
    category: definition.category,
    body,
    css: stored?.css ?? null,
    subject,
    subjectOnly: !!definition.subjectOnly,
    variables: definition.variables,
    customized: definition.subjectOnly ? subject !== (definition.defaultSubject ?? null) : customized,
    updatedBy: stored?.updatedBy ?? null,
    updatedAt: stored?.updatedAt ?? null,
  };
}

export async function getAllMessageTemplates(): Promise<ResolvedMessageTemplate[]> {
  return Promise.all(
    (Object.keys(MESSAGE_TEMPLATE_CATALOG) as MessageTemplateKey[]).map((key) => getMessageTemplate(key))
  );
}

/**
 * Substitute {{placeholders}}. Unknown placeholders are left intact so a
 * partially-edited template fails visibly instead of silently losing data.
 */
export function renderMessageTemplate(body: string, variables: Record<string, string>): string {
  return body.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = variables[name];
    return value === undefined ? match : value;
  });
}

export interface ResolvedEmailContent {
  subject: string;
  html: string;
}

/**
 * Resolve an email's subject and body through the operator-editable template
 * catalog with zero-drift defaults:
 *  - Subject: stored/catalog subject rendered with {{vars}}; the caller's
 *    code subject wins when the template defines none.
 *  - Body: the caller's inline HTML (byte-identical legacy output) until an
 *    operator has actually customized the stored row; customized bodies are
 *    rendered with {{vars}}. Subject-only templates always keep the code
 *    body.
 * Values passed in MUST already be escaped by callers when destined for HTML.
 * Unknown keys return the fallback untouched so new senders work before their
 * catalog entry lands.
 */
export async function resolveEmailContent(
  key: MessageTemplateKey,
  variables: Record<string, string>,
  fallback: ResolvedEmailContent
): Promise<ResolvedEmailContent> {
  if (!isKnownMessageTemplateKey(key)) {
    return { subject: fallback.subject, html: fallback.html };
  }
  const template = await getMessageTemplate(key);
  const subject = template.subject
    ? renderMessageTemplate(template.subject, variables).trim() || fallback.subject
    : fallback.subject;
  let bodySource = fallback.html;
  if (!template.subjectOnly && template.customized && template.body) {
    bodySource = template.body;
  }
  const rendered = renderMessageDocument(bodySource, variables, template.css ?? '');
  return { subject, html: rendered.html };
}
