import type { Prisma } from '@prisma/client';
import { prisma } from './db';

export interface AuditFilters {
  from?: Date;
  to?: Date;
  action?: string;
  category?: string;
  outcome?: string;
  username?: string;
  clientId?: string;
  riskLevel?: string;
  ip?: string;
  query?: string;
}

export const MAX_AUDIT_PAGE = 200;
export const MAX_AUDIT_EXPORT_ROWS = 100_000;
export const MAX_AUDIT_RANGE_DAYS = 365;

function boundedText(value: unknown, max = 120): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : undefined;
}

function dateValue(value: unknown): Date | undefined {
  const text = boundedText(value, 40);
  if (!text) return undefined;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function parseAuditFilters(input: URLSearchParams | Record<string, unknown>): AuditFilters {
  const get = (key: string): unknown => input instanceof URLSearchParams ? input.get(key) : input[key];
  return {
    from: dateValue(get('from')),
    to: dateValue(get('to')),
    action: boundedText(get('action')),
    category: boundedText(get('category')),
    outcome: boundedText(get('outcome')),
    username: boundedText(get('username')),
    clientId: boundedText(get('clientId')),
    riskLevel: boundedText(get('riskLevel'), 16),
    ip: boundedText(get('ip'), 64),
    query: boundedText(get('q'), 160),
  };
}

function whereFor(filters: AuditFilters): Prisma.AuditLogWhereInput {
  const where: Prisma.AuditLogWhereInput = {};
  if (filters.from || filters.to) {
    where.createdAt = { ...(filters.from ? { gte: filters.from } : {}), ...(filters.to ? { lte: filters.to } : {}) };
  }
  if (filters.action) where.action = { contains: filters.action, mode: 'insensitive' };
  if (filters.category) where.category = filters.category;
  if (filters.outcome) where.outcome = filters.outcome;
  if (filters.clientId) where.clientId = filters.clientId;
  if (filters.riskLevel) where.riskLevel = filters.riskLevel;
  if (filters.ip) where.ipAddress = { contains: filters.ip };
  if (filters.username) {
    where.OR = [
      { username: { contains: filters.username, mode: 'insensitive' } },
      { subjectUsername: { contains: filters.username, mode: 'insensitive' } },
    ];
  }
  if (filters.query) {
    const search = [
      { action: { contains: filters.query, mode: 'insensitive' as const } },
      { details: { contains: filters.query, mode: 'insensitive' as const } },
      { username: { contains: filters.query, mode: 'insensitive' as const } },
      { subjectUsername: { contains: filters.query, mode: 'insensitive' as const } },
    ];
    where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { OR: search }];
  }
  return where;
}

export async function queryAuditEvents(
  filters: AuditFilters,
  options: { limit?: number; cursor?: string } = {}
) {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), MAX_AUDIT_PAGE);
  const rows = await prisma.auditLog.findMany({
    where: whereFor(filters),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: {
      id: true, createdAt: true, action: true, category: true, username: true,
      actorType: true, subjectUsername: true, eventKind: true, outcome: true,
      targetId: true, clientId: true, providerSid: true, riskLevel: true,
      details: true, ipAddress: true, userAgent: true, success: true,
    },
  });
  const hasMore = rows.length > limit;
  const events = hasMore ? rows.slice(0, limit) : rows;
  return { events, nextCursor: hasMore ? events.at(-1)?.id ?? null : null };
}

export async function exportAuditEvents(filters: AuditFilters) {
  const from = filters.from ?? new Date(Date.now() - 24 * 60 * 60 * 1000);
  const to = filters.to ?? new Date();
  if (to.getTime() < from.getTime() || to.getTime() - from.getTime() > MAX_AUDIT_RANGE_DAYS * 86_400_000) {
    throw new Error(`export range must be between 0 and ${MAX_AUDIT_RANGE_DAYS} days`);
  }
  const rows = await prisma.auditLog.findMany({
    where: whereFor({ ...filters, from, to }),
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: MAX_AUDIT_EXPORT_ROWS + 1,
    select: {
      id: true, createdAt: true, action: true, category: true, username: true,
      actorType: true, subjectUsername: true, eventKind: true, outcome: true,
      targetId: true, clientId: true, providerSid: true, riskLevel: true,
      details: true, ipAddress: true, userAgent: true, success: true,
    },
  });
  if (rows.length > MAX_AUDIT_EXPORT_ROWS) throw new Error('export exceeds 100000 rows; narrow the filters');
  return rows;
}

const EXPORT_FIELDS = [
  'id', 'createdAt', 'action', 'category', 'username', 'actorType', 'subjectUsername',
  'eventKind', 'outcome', 'targetId', 'clientId', 'providerSid', 'riskLevel',
  'ipAddress', 'userAgent', 'success', 'details',
] as const;

function cell(value: unknown): string {
  let text = value instanceof Date ? value.toISOString() : String(value ?? '');
  // Spreadsheet engines may ignore leading whitespace/control bytes before
  // interpreting a formula. Prefix every such cell before RFC quoting.
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function auditRowsToCsv(rows: Awaited<ReturnType<typeof exportAuditEvents>>): string {
  const header = EXPORT_FIELDS.map(cell).join(',');
  const body = rows.map((row) => EXPORT_FIELDS.map((field) => cell(row[field])).join(',')).join('\r\n');
  return `${header}\r\n${body}${body ? '\r\n' : ''}`;
}

export function auditRowsToNdjson(rows: Awaited<ReturnType<typeof exportAuditEvents>>): string {
  return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : '');
}
