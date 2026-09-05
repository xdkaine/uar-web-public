import { prisma } from './db';
import type { Prisma } from '@prisma/client';
import {
  DEFAULT_BRANDING_CLIENT_ID,
  defaultBrandingDoc,
  validateBrandingDoc,
  type BrandingDoc,
} from './branding';

/**
 * Persistence + caching for per-client branding profiles. The service owns
 * the AuthBrandingProfile table (ADR-0012 data ownership); the portal writes
 * through the internal API. Reads happen on the interaction hot path, so a
 * short in-memory TTL keeps DB load flat while still picking up edits within
 * seconds.
 */

const CACHE_TTL_MS = 30_000;

const cache = new Map<string, { doc: BrandingDoc; loadedAt: number }>();

function isFresh(entry: { loadedAt: number }): boolean {
  return Date.now() - entry.loadedAt < CACHE_TTL_MS;
}

async function readStoredDoc(clientId: string): Promise<BrandingDoc | null> {
  const row = await prisma.authBrandingProfile.findUnique({
    where: { clientId },
    select: { doc: true },
  });
  if (!row) return null;
  const parsed = validateBrandingDoc(row.doc);
  if (parsed.ok) return parsed.value;
  // A row that no longer validates (e.g. written outside the API by an older
  // schema) must never reach the renderer: log loudly and fall through to
  // the default profile chain.
  console.error(`[auth] branding profile "${clientId}" failed validation`, parsed.issues);
  return null;
}

export async function loadBrandingDoc(clientId: string): Promise<BrandingDoc> {
  const cached = cache.get(clientId);
  if (cached && isFresh(cached)) return cached.doc;

  try {
    const stored = await readStoredDoc(clientId);
    if (stored) {
      cache.set(clientId, { doc: stored, loadedAt: Date.now() });
      return stored;
    }
    if (clientId !== DEFAULT_BRANDING_CLIENT_ID) {
      const fallback = await loadBrandingDoc(DEFAULT_BRANDING_CLIENT_ID);
      // Cache under the requested key too so a missing profile does not hit
      // the fallback path on every login.
      cache.set(clientId, { doc: fallback, loadedAt: Date.now() });
      return fallback;
    }
  } catch (error) {
    console.error('[auth] branding profile lookup failed', error);
  }

  const builtin = defaultBrandingDoc();
  cache.set(clientId, { doc: builtin, loadedAt: Date.now() });
  return builtin;
}

export async function saveBrandingDoc(
  clientId: string,
  doc: BrandingDoc,
  updatedBy: string,
  audit: { action?: string; details?: Record<string, unknown> } = {}
): Promise<number> {
  const jsonDoc = JSON.parse(JSON.stringify(doc)) as Prisma.InputJsonValue;
  let savedRevision = 0;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      savedRevision = await prisma.$transaction(async (tx) => {
        const latest = await tx.authBrandingRevision.findFirst({
          where: { clientId }, orderBy: { revision: 'desc' }, select: { revision: true },
        });
        const revision = (latest?.revision ?? 0) + 1;
        await tx.authBrandingProfile.upsert({
          where: { clientId },
          create: { clientId, doc: jsonDoc, updatedBy, version: doc.version },
          update: { doc: jsonDoc, updatedBy, version: doc.version },
        });
        await tx.authBrandingRevision.updateMany({
          where: { clientId, status: 'published' }, data: { status: 'archived' },
        });
        await tx.authBrandingRevision.create({
          data: {
            clientId, revision, status: 'published', doc: jsonDoc,
            createdBy: updatedBy, publishedAt: new Date(),
          },
        });
        await tx.auditLog.create({
          data: {
            action: audit.action ?? 'AUTH_BRANDING_UPDATED',
            category: 'configuration',
            username: updatedBy,
            actorType: 'admin',
            targetId: clientId,
            clientId,
            eventKind: 'security',
            outcome: 'success',
            details: JSON.stringify({ clientId, blocks: doc.blocks.length, revision, ...audit.details }),
            success: true,
          },
        });
        return revision;
      }, { isolationLevel: 'Serializable' });
      break;
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code?: unknown }).code)
        : '';
      if (attempt === 2 || !(error instanceof Error) || (code !== 'P2034' && !/write conflict|deadlock/i.test(error.message))) {
        throw error;
      }
    }
  }
  cache.delete(clientId);
  return savedRevision;
}

export async function listBrandingRevisions(clientId: string): Promise<Array<{
  id: string; revision: number; status: string; createdBy: string; createdAt: Date; publishedAt: Date | null;
}>> {
  return prisma.authBrandingRevision.findMany({
    where: { clientId },
    orderBy: { revision: 'desc' },
    take: 50,
    select: { id: true, revision: true, status: true, createdBy: true, createdAt: true, publishedAt: true },
  });
}

export async function restoreBrandingRevision(
  clientId: string,
  revision: number,
  actor: string
): Promise<boolean> {
  const row = await prisma.authBrandingRevision.findUnique({
    where: { clientId_revision: { clientId, revision } },
    select: { doc: true },
  });
  if (!row) return false;
  const parsed = validateBrandingDoc(row.doc);
  if (!parsed.ok) return false;
  await saveBrandingDoc(clientId, parsed.value, actor, {
    action: 'AUTH_BRANDING_RESTORED',
    details: { sourceRevision: revision },
  });
  return true;
}

/** Test/ops hook: drop cached docs so the next read hits the database. */
export function invalidateBrandingCache(clientId?: string): void {
  if (clientId) cache.delete(clientId);
  else cache.clear();
}

/** Console listing: profile rows without their (potentially large) docs. */
export async function listBrandingProfiles(): Promise<
  Array<{ clientId: string; version: number; updatedAt: Date }>
> {
  const rows = await prisma.authBrandingProfile.findMany({
    select: { clientId: true, version: true, updatedAt: true },
    orderBy: { updatedAt: 'desc' },
  });
  return rows;
}

/** Raw stored doc for the console editor (already schema-validated on write). */
export async function getRawBrandingDoc(
  clientId: string
): Promise<unknown | null> {
  const row = await prisma.authBrandingProfile.findUnique({
    where: { clientId },
    select: { doc: true },
  });
  return row?.doc ?? null;
}
