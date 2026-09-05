import { randomBytes } from 'node:crypto';

/**
 * Sign-in page preview drafts (console rework). Rendering the preview via
 * iframe srcdoc is impossible under the console CSP: srcdoc documents
 * inherit the embedder's policy, and `frame-ancestors 'none'` then blocks
 * the frame itself - the preview rendered permanently blank. Instead the
 * console POSTs the draft, gets back a single-use-capable token, and points
 * the iframe at /admin/preview/<token>, which serves the rendered page with
 * its own CSP that allows framing by 'self' and nothing else.
 *
 * Tokens are 256-bit random, TTL-bounded, capped in count, and the rendered
 * HTML is regenerated from the validated document - never stored as raw
 * operator input beyond the draft's lifetime.
 */

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MAX_LIVE_PREVIEWS = 20;

interface PreviewDraft {
  html: string;
  createdAt: number;
}

const drafts = new Map<string, PreviewDraft>();

function evictExpired(now: number): void {
  for (const [token, draft] of drafts) {
    if (now - draft.createdAt > PREVIEW_TTL_MS) drafts.delete(token);
  }
}

export function createPreviewDraft(html: string): string {
  const now = Date.now();
  evictExpired(now);
  while (drafts.size >= MAX_LIVE_PREVIEWS) {
    const oldest = [...drafts.entries()].sort((a, b) => a[1].createdAt - b[1].createdAt)[0];
    if (!oldest) break;
    drafts.delete(oldest[0]);
  }
  const token = randomBytes(32).toString('base64url');
  drafts.set(token, { html, createdAt: now });
  return token;
}

export function consumePreviewDraft(token: string): string | null {
  // Bounded token shape first: never feed arbitrary attacker strings into Map lookups.
  if (!token || token.length > 64 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
  const draft = drafts.get(token);
  if (!draft) return null;
  if (Date.now() - draft.createdAt > PREVIEW_TTL_MS) {
    drafts.delete(token);
    return null;
  }
  return draft.html;
}

/** Test seam. */
export function resetPreviewDrafts(): void {
  drafts.clear();
}
