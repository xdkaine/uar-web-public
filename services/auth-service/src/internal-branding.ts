import { createHash, timingSafeEqual } from 'node:crypto';
import type http from 'node:http';
import { CLIENT_ID_PATTERN, validateBrandingDoc, type BrandingDoc } from './branding';
import { loadBrandingDoc, saveBrandingDoc } from './branding-store';
import { prisma } from './db';
import { renderBrandingPage } from './render';
import { clientIp, readRawBody } from './httputil';
import type { AuthConfig } from './config';

/**
 * Token-guarded internal API consumed by the portal admin editor over the
 * compose network only (never exposed by nginx — see docs/deploy/):
 *
 *   GET  /internal/branding/:clientId   -> stored profile (404 when absent)
 *   PUT  /internal/branding/:clientId   -> validate + upsert + audit
 *   POST /internal/branding/render      -> rendered login preview HTML
 *
 * Requests require header `x-internal-token` matching
 * AUTH_INTERNAL_BRANDING_TOKEN. Unset token => the whole surface fails
 * closed with 503. All writes are audited in branding-store.
 */

export const INTERNAL_BRANDING_PATH_PATTERN = /^\/internal\/branding\/([A-Za-z0-9_-]{1,64})$/;

const MAX_JSON_BODY_BYTES = 128 * 1024;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 120;

const rateHits = new Map<string, number[]>();

function allowRate(key: string): boolean {
  const now = Date.now();
  const hits = (rateHits.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  // Prune keys whose count returned to zero so the map cannot grow without
  // bound across many one-time client addresses.
  if (!hits.length) rateHits.delete(key);
  if (hits.length >= RATE_MAX_REQUESTS) {
    rateHits.set(key, hits);
    return false;
  }
  hits.push(now);
  rateHits.set(key, hits);
  return true;
}

function constantTimeEquals(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

function sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRawBody(req, MAX_JSON_BODY_BYTES);
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('Invalid JSON body');
  }
}

function extractToken(req: http.IncomingMessage): string | null {
  const value = req.headers['x-internal-token'];
  if (typeof value === 'string' && value.length > 0) return value;
  return null;
}

export async function handleInternalBrandingRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  subPath: string,
  config: AuthConfig
): Promise<void> {
  if (!config.internalBrandingToken) {
    sendJson(res, 503, { error: 'internal_api_disabled' });
    return;
  }

  const ip = clientIp(req, { trustForwardedHeaders: config.trustProxyHeaders });
  if (!allowRate(ip)) {
    sendJson(res, 429, { error: 'rate_limited' });
    return;
  }

  const presented = extractToken(req);
  if (!presented || !constantTimeEquals(presented, config.internalBrandingToken)) {
    console.error(`[auth] rejected internal branding request from ${ip}`);
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }

  try {
    // Route split guarantees "render" never collides with a clientId key.
    if (req.method === 'POST' && subPath === 'render') {
      await handleRenderPreview(req, res, config);
      return;
    }

    if (!CLIENT_ID_PATTERN.test(subPath) || subPath === 'render') {
      sendJson(res, 404, { error: 'not_found' });
      return;
    }
    const clientId = subPath;

    if (req.method === 'GET') {
      const exists = await storedProfileExists(clientId);
      if (!exists) {
        sendJson(res, 404, { error: 'not_found' });
        return;
      }
      const doc = await loadBrandingDoc(clientId);
      sendJson(res, 200, { clientId, doc });
      return;
    }

    if (req.method === 'PUT') {
      await handlePutProfile(req, res, clientId);
      return;
    }

    res.writeHead(405, { Allow: 'GET, PUT' }).end();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal error';
    const status = message.includes('body too large')
      ? 413
      : message.includes('Invalid JSON')
        ? 400
        : 500;
    if (status === 500) console.error('[auth] internal branding handler failed', error);
    sendJson(res, status, { error: status === 500 ? 'server_error' : message });
  }
}

/** Distinguish "no stored row" from the built-in fallback document. */
async function storedProfileExists(clientId: string): Promise<boolean> {
  const row = await prisma.authBrandingProfile.findUnique({
    where: { clientId },
    select: { id: true },
  });
  return row !== null;
}

async function handlePutProfile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  clientId: string
): Promise<void> {
  const body = await readJsonBody(req);
  const updatedByRaw = body.updatedBy;
  const updatedBy =
    typeof updatedByRaw === 'string' ? updatedByRaw.trim().slice(0, 120) : '';
  if (!updatedBy) {
    sendJson(res, 400, { error: 'updatedBy is required' });
    return;
  }
  const parsed = validateBrandingDoc(body.doc);
  if (!parsed.ok) {
    sendJson(res, 400, { error: 'invalid_branding_document', issues: parsed.issues });
    return;
  }
  const doc: BrandingDoc = parsed.value;
  await saveBrandingDoc(clientId, doc, updatedBy);
  sendJson(res, 200, { ok: true, clientId });
}

async function handleRenderPreview(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  config: AuthConfig
): Promise<void> {
  const body = await readJsonBody(req);
  const parsed = validateBrandingDoc(body.doc);
  if (!parsed.ok) {
    sendJson(res, 400, { error: 'invalid_branding_document', issues: parsed.issues });
    return;
  }
  const html = renderBrandingPage('login', parsed.value, {
    uid: 'preview-interaction',
    turnstileSiteKey: config.turnstileSiteKey,
    preview: true,
  });
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}
