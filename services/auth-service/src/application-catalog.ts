import { prisma } from './db';
import type { Prisma } from '@prisma/client';

export const CATALOG_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/;
export const CATALOG_KINDS = ['oidc', 'external'] as const;
export const CATALOG_VISIBILITIES = ['public', 'hidden'] as const;

export interface CatalogEntryView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  launchUrl: string;
  iconUrl: string | null;
  kind: (typeof CATALOG_KINDS)[number];
  oidcClientId: string | null;
  visibility: (typeof CATALOG_VISIBILITIES)[number];
  sortOrder: number;
  publishedAt: Date | null;
}

export interface CatalogEntryInput {
  slug: string;
  name: string;
  description?: string | null;
  launchUrl: string;
  iconUrl?: string | null;
  kind: (typeof CATALOG_KINDS)[number];
  oidcClientId?: string | null;
  visibility: (typeof CATALOG_VISIBILITIES)[number];
  sortOrder?: number;
}

function retryableTransactionError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : '';
  return code === 'P2034' || /write conflict|deadlock/i.test(error.message);
}

async function serializableCatalogTransaction<T>(
  work: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (attempt === 2 || !retryableTransactionError(error)) throw error;
    }
  }
  throw new Error('serializable catalog transaction retry exhausted');
}

function httpsUrl(value: unknown, field: string, optional = false): string | null {
  if ((value === undefined || value === null || value === '') && optional) return null;
  if (typeof value !== 'string' || value.length > 2048) throw new Error(`${field} must be an https URL`);
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error(`${field} must be an https URL`);
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) {
    throw new Error(`${field} must be an https URL without embedded credentials`);
  }
  return parsed.toString();
}

export function validateCatalogEntry(input: Record<string, unknown>): CatalogEntryInput {
  const slug = typeof input.slug === 'string' ? input.slug.trim().toLowerCase() : '';
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  const description = typeof input.description === 'string' ? input.description.trim() : null;
  const kind = input.kind;
  const visibility = input.visibility;
  const oidcClientId = typeof input.oidcClientId === 'string' && input.oidcClientId.trim()
    ? input.oidcClientId.trim()
    : null;
  const sortOrder = input.sortOrder === undefined ? 0 : Number(input.sortOrder);

  if (!CATALOG_SLUG_PATTERN.test(slug)) throw new Error('slug must use 3-64 lowercase letters, numbers, or hyphens');
  if (!name || name.length > 120) throw new Error('name is required and must be at most 120 characters');
  if (description && description.length > 240) throw new Error('description must be at most 240 characters');
  if (!CATALOG_KINDS.includes(kind as CatalogEntryInput['kind'])) throw new Error('kind must be oidc or external');
  if (!CATALOG_VISIBILITIES.includes(visibility as CatalogEntryInput['visibility'])) {
    throw new Error('visibility must be public or hidden');
  }
  if (kind === 'oidc' && !oidcClientId) throw new Error('oidcClientId is required for OIDC applications');
  if (kind === 'external' && oidcClientId) throw new Error('oidcClientId is only valid for OIDC applications');
  if (!Number.isInteger(sortOrder) || sortOrder < -10_000 || sortOrder > 10_000) {
    throw new Error('sortOrder must be an integer between -10000 and 10000');
  }

  return {
    slug,
    name,
    description: description || null,
    launchUrl: httpsUrl(input.launchUrl, 'launchUrl') as string,
    iconUrl: httpsUrl(input.iconUrl, 'iconUrl', true),
    kind: kind as CatalogEntryInput['kind'],
    oidcClientId,
    visibility: visibility as CatalogEntryInput['visibility'],
    sortOrder,
  };
}

function toView(row: {
  id: string; slug: string; name: string; description: string | null; launchUrl: string;
  iconUrl: string | null; kind: string; oidcClientId: string | null; visibility: string;
  sortOrder: number; publishedAt: Date | null;
}): CatalogEntryView {
  return {
    ...row,
    kind: CATALOG_KINDS.includes(row.kind as CatalogEntryView['kind'])
      ? row.kind as CatalogEntryView['kind'] : 'external',
    visibility: row.visibility === 'public' ? 'public' : 'hidden',
  };
}

function launchOriginAllowed(launchUrl: string, redirectUris: unknown): boolean {
  if (!Array.isArray(redirectUris)) return false;
  const launchOrigin = new URL(launchUrl).origin;
  return redirectUris.some((value) => {
    if (typeof value !== 'string') return false;
    try {
      return new URL(value).origin === launchOrigin;
    } catch {
      return false;
    }
  });
}

export async function listPublishedCatalogEntries(): Promise<CatalogEntryView[]> {
  const rows = await prisma.applicationCatalogEntry.findMany({
    where: { visibility: 'public', publishedAt: { not: null } },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
  });
  const clientIds = Array.from(new Set(rows
    .filter((row) => row.kind === 'oidc' && row.oidcClientId)
    .map((row) => row.oidcClientId as string)));
  const clients = clientIds.length > 0
    ? await prisma.oidcClient.findMany({
        where: { clientId: { in: clientIds } },
        select: { clientId: true, enabled: true, redirectUris: true },
      })
    : [];
  const clientById = new Map(clients.map((client) => [client.clientId, client]));
  return rows.filter((row) => {
    if (row.kind !== 'oidc') return true;
    const client = row.oidcClientId ? clientById.get(row.oidcClientId) : null;
    return Boolean(client?.enabled && launchOriginAllowed(row.launchUrl, client.redirectUris));
  }).map(toView);
}

export async function listCatalogEntries(): Promise<CatalogEntryView[]> {
  const rows = await prisma.applicationCatalogEntry.findMany({
    orderBy: [{ visibility: 'desc' }, { sortOrder: 'asc' }, { name: 'asc' }],
  });
  return rows.map(toView);
}

export async function createCatalogEntry(
  input: CatalogEntryInput,
  actor: string
): Promise<CatalogEntryView> {
  const row = await serializableCatalogTransaction(async (tx) => {
    if (input.kind === 'oidc' && input.visibility === 'public') {
      const client = await tx.oidcClient.findUnique({
        where: { clientId: input.oidcClientId as string }, select: { enabled: true, redirectUris: true },
      });
      if (!client?.enabled) throw new Error('OIDC application must be enabled before it can be published');
      if (!launchOriginAllowed(input.launchUrl, client.redirectUris)) {
        throw new Error('OIDC application launch origin must match a registered redirect origin');
      }
    }
    const created = await tx.applicationCatalogEntry.create({
      data: {
        ...input,
        publishedAt: input.visibility === 'public' ? new Date() : null,
        createdBy: actor,
        updatedBy: actor,
      },
    });
    await tx.auditLog.create({
      data: {
        action: 'APPLICATION_CATALOG_CREATED', category: 'configuration', username: actor,
        actorType: 'admin', targetId: created.id, eventKind: 'security', outcome: 'success',
        details: JSON.stringify({ slug: created.slug, kind: created.kind, visibility: created.visibility }),
        success: true,
      },
    });
    return created;
  });
  return toView(row);
}

export async function updateCatalogEntry(
  id: string,
  input: CatalogEntryInput,
  actor: string
): Promise<CatalogEntryView | null> {
  const row = await serializableCatalogTransaction(async (tx) => {
    const existing = await tx.applicationCatalogEntry.findUnique({ where: { id } });
    if (!existing) return null;
    if (input.kind === 'oidc' && input.visibility === 'public') {
      const client = await tx.oidcClient.findUnique({
        where: { clientId: input.oidcClientId as string }, select: { enabled: true, redirectUris: true },
      });
      if (!client?.enabled) throw new Error('OIDC application must be enabled before it can be published');
      if (!launchOriginAllowed(input.launchUrl, client.redirectUris)) {
        throw new Error('OIDC application launch origin must match a registered redirect origin');
      }
    }
    const updated = await tx.applicationCatalogEntry.update({
      where: { id },
      data: {
        ...input,
        publishedAt: input.visibility === 'public' ? (existing.publishedAt ?? new Date()) : null,
        updatedBy: actor,
      },
    });
    await tx.auditLog.create({
      data: {
        action: 'APPLICATION_CATALOG_UPDATED', category: 'configuration', username: actor,
        actorType: 'admin', targetId: updated.id, eventKind: 'security', outcome: 'success',
        details: JSON.stringify({ slug: updated.slug, kind: updated.kind, visibility: updated.visibility }),
        success: true,
      },
    });
    return updated;
  });
  return row ? toView(row) : null;
}

export async function deleteCatalogEntry(id: string, actor: string): Promise<boolean> {
  return serializableCatalogTransaction(async (tx) => {
    const existing = await tx.applicationCatalogEntry.findUnique({ where: { id } });
    if (!existing) return false;
    await tx.applicationCatalogEntry.delete({ where: { id } });
    await tx.auditLog.create({
      data: {
        action: 'APPLICATION_CATALOG_DELETED', category: 'configuration', username: actor,
        actorType: 'admin', targetId: id, eventKind: 'security', outcome: 'success',
        details: JSON.stringify({ slug: existing.slug, kind: existing.kind, visibility: existing.visibility }),
        success: true,
      },
    });
    return true;
  });
}
