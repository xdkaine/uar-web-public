import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { getConfigValue } from '@/lib/config/resolver';
import { prisma } from '@/lib/prisma';
import type { ManagedPageDocument } from '@/lib/appearance-pages';
import {
  DEFAULT_NAV_LINKS,
  DEFAULT_REQUEST_EXTERNAL_CONTENT,
  DEFAULT_REQUEST_INTERNAL_CONTENT,
  validateNavLinks,
  type NavLinkConfig,
  type PageContentConfig,
  PAGE_APPEARANCE_IDS,
  PAGE_APPEARANCE_REGISTRY,
  normalizeLegacyPageContent,
  validateRegisteredPageContent,
  validateAppearanceTheme,
  DEFAULT_APPEARANCE_THEME,
} from '@/lib/appearance';

export const dynamic = 'force-dynamic';

function versionedAppearanceResponse(
  payload: Record<string, unknown>,
  request?: NextRequest,
) {
  const appearanceVersion = createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('base64url')
    .slice(0, 24);
  const etag = `"${appearanceVersion}"`;
  const headers = {
    ETag: etag,
    'Cache-Control': 'private, no-cache, must-revalidate',
  };
  if (request?.headers.get('if-none-match') === etag) {
    return new NextResponse(null, { status: 304, headers });
  }
  return NextResponse.json({ ...payload, appearanceVersion }, { headers });
}

function mergeContent(
  stored: PageContentConfig,
  fallback: PageContentConfig
): PageContentConfig {
  return {
    title: stored.title || fallback.title,
    subtitle: stored.subtitle || fallback.subtitle,
    notice: stored.notice ?? fallback.notice,
  };
}

/**
 * Public appearance resolution: navbar overrides and access-request page
 * copy. Read-only, no auth (the data is what every anonymous visitor sees
 * anyway), and fails open to the built-in defaults.
 */
export async function GET(request?: NextRequest) {
  try {
    const [themeRaw, navRaw, publishedRegions, ...pageRawValues] = await Promise.all([
      getConfigValue<string>('appearance.theme').catch(() => ''),
      getConfigValue<string>('nav.links').catch(() => ''),
      prisma.managedPageRevision.findMany({ where: { status: 'published' }, orderBy: { version: 'desc' }, select: { pageKey: true, document: true } }).catch(() => []),
      ...PAGE_APPEARANCE_IDS.map((id) => getConfigValue<string>(PAGE_APPEARANCE_REGISTRY[id].key).catch(() => '')),
    ]);

    let navLinks: NavLinkConfig[] = DEFAULT_NAV_LINKS;
    try {
      const parsed = validateNavLinks(navRaw);
      if (parsed.length > 0) navLinks = parsed;
    } catch {
      // Invalid stored overrides fall back to defaults; admins are alerted
      // through the configuration UI which validates on save.
    }

    const pages = Object.fromEntries(PAGE_APPEARANCE_IDS.map((id, index) => {
      const registration = PAGE_APPEARANCE_REGISTRY[id];
      const raw = pageRawValues[index] ?? '';
      if (!raw) return [id, registration.defaultContent];
      try {
        return [
          id,
          normalizeLegacyPageContent(
            id,
            mergeContent(validateRegisteredPageContent(registration.key, raw), registration.defaultContent)
          ),
        ];
      } catch (error) {
        console.error(`Invalid stored appearance value for ${registration.key}:`, error);
        return [id, registration.defaultContent];
      }
    }));
    const managedPages: Record<string, ManagedPageDocument> = {};
    for (const revision of publishedRegions) {
      if (!managedPages[revision.pageKey]) managedPages[revision.pageKey] = revision.document as unknown as ManagedPageDocument;
    }

    let theme = DEFAULT_APPEARANCE_THEME;
    try { if (themeRaw) theme = validateAppearanceTheme(themeRaw); } catch { /* use constrained defaults */ }
    return versionedAppearanceResponse({
      theme,
      navLinks,
      pages,
      managedPages,
      requestInternal: pages.requestInternal,
      requestExternal: pages.requestExternal,
    }, request);
  } catch (error) {
    console.error('Failed to resolve appearance configuration:', error);
    return versionedAppearanceResponse({
      navLinks: DEFAULT_NAV_LINKS,
      theme: DEFAULT_APPEARANCE_THEME,
      requestInternal: DEFAULT_REQUEST_INTERNAL_CONTENT,
      requestExternal: DEFAULT_REQUEST_EXTERNAL_CONTENT,
      pages: Object.fromEntries(PAGE_APPEARANCE_IDS.map((id) => [id, PAGE_APPEARANCE_REGISTRY[id].defaultContent])),
      managedPages: {},
    }, request);
  }
}
