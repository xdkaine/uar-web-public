'use client';

import type { Dispatch } from 'react';

import {
  DEFAULT_APPEARANCE_THEME,
  DEFAULT_NAV_LINKS,
  DEFAULT_REQUEST_EXTERNAL_CONTENT,
  DEFAULT_REQUEST_INTERNAL_CONTENT,
  normalizeLegacyPageContent,
  PAGE_APPEARANCE_IDS,
  PAGE_APPEARANCE_REGISTRY,
  type AppearanceThemeConfig,
  type NavLinkConfig,
  type PageAppearanceId,
  type PageContentConfig,
} from '@/lib/appearance';
import { EMPTY_MANAGED_PAGE, type ManagedPageDocument } from '@/lib/appearance-pages';

export type StoredValues = Record<string, unknown> & {
  revisions?: Array<{ id: string; key: string; createdAt: string; changedBy: string; changeKind: string }>;
};

export type ManagedRevision = {
  id: string;
  pageKey: PageAppearanceId;
  version: number;
  status: string;
  document: ManagedPageDocument;
  updatedAt: string;
  updatedBy: string;
};

export type AppearanceHistoryItem = {
  source: 'configuration' | 'managed_page';
  id: string;
  key: string;
  version: number | null;
  status: string;
  actor: string;
  createdAt: string;
};

export type AppearanceSection = 'theme' | 'navigation' | 'pages' | 'history';
export type EditableNavLink = NavLinkConfig & { editorKey: string };

export interface AppearancePanelState {
  appearanceHistory: AppearanceHistoryItem[];
  appearanceHistoryPage: { total: number; nextCursor: string | null; hasNext: boolean };
  links: EditableNavLink[];
  loading: boolean;
  managedDrafts: Partial<Record<PageAppearanceId, ManagedPageDocument>>;
  managedRevisions: ManagedRevision[];
  message: { type: 'success' | 'error'; text: string } | null;
  pageContent: Record<PageAppearanceId, PageContentConfig>;
  requestExternal: PageContentConfig;
  requestInternal: PageContentConfig;
  saving: boolean;
  section: AppearanceSection;
  selectedPage: PageAppearanceId;
  theme: AppearanceThemeConfig;
}

export type AppearancePanelAction =
  | { type: 'addLink' }
  | { type: 'hydrateConfig'; values: StoredValues }
  | { type: 'setAppearanceHistory'; items: AppearanceHistoryItem[]; pageInfo?: AppearancePanelState['appearanceHistoryPage']; append: boolean }
  | { type: 'setLoading'; loading: boolean }
  | { type: 'setManagedRevisions'; revisions: ManagedRevision[] }
  | { type: 'setMessage'; message: AppearancePanelState['message'] }
  | { type: 'setPageContent'; page: PageAppearanceId; value: PageContentConfig }
  | { type: 'setRequestExternal'; value: PageContentConfig }
  | { type: 'setRequestInternal'; value: PageContentConfig }
  | { type: 'setSaving'; saving: boolean }
  | { type: 'setSection'; section: AppearanceSection }
  | { type: 'setSelectedPage'; page: PageAppearanceId }
  | { type: 'setTheme'; theme: AppearanceThemeConfig }
  | { type: 'setManagedDraft'; page: PageAppearanceId; document: ManagedPageDocument }
  | { type: 'removeLink'; editorKey: string }
  | { type: 'moveLink'; editorKey: string; direction: -1 | 1 }
  | { type: 'resetLinks' }
  | { type: 'updateLink'; editorKey: string; patch: Partial<NavLinkConfig> };

export type AppearanceDispatch = Dispatch<AppearancePanelAction>;

export const NAVBAR_PREVIEW_OPTIONS: Array<{ value: 'anonymous' | 'user' | 'admin'; label: string }> = [
  { value: 'anonymous', label: 'Signed-out visitor' },
  { value: 'user', label: 'Signed-in user' },
  { value: 'admin', label: 'Administrator' },
];

function newEditorKey(): string {
  return crypto.randomUUID();
}

export function toEditableLinks(links: NavLinkConfig[]): EditableNavLink[] {
  return links.map((link) => ({ ...link, editorKey: newEditorKey() }));
}

export function parseStoredNav(raw: string): EditableNavLink[] {
  if (!raw.trim()) return toEditableLinks(DEFAULT_NAV_LINKS);
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0
      ? toEditableLinks(parsed as NavLinkConfig[])
      : toEditableLinks(DEFAULT_NAV_LINKS);
  } catch {
    return toEditableLinks(DEFAULT_NAV_LINKS);
  }
}

export function parseStoredContent(raw: string, fallback: PageContentConfig): PageContentConfig {
  if (!raw.trim()) return { ...fallback };
  try {
    const parsed = JSON.parse(raw);
    return {
      title: typeof parsed.title === 'string' ? parsed.title : '',
      subtitle: typeof parsed.subtitle === 'string' ? parsed.subtitle : '',
      notice: typeof parsed.notice === 'string' ? parsed.notice : undefined,
    };
  } catch {
    return { ...fallback };
  }
}

export function normalizeLinks(list: NavLinkConfig[]): NavLinkConfig[] {
  return list.map((link) => ({
    label: link.label,
    href: link.href,
    section: link.section === 'services' ? 'services' : 'main',
    requiresAuth: link.requiresAuth === true,
    requiresAdmin: link.requiresAdmin === true,
  }));
}

export function persistedLinks(list: EditableNavLink[]): NavLinkConfig[] {
  return list.map((link) => ({
    label: link.label,
    href: link.href,
    section: link.section,
    ...(link.requiresAuth === undefined ? {} : { requiresAuth: link.requiresAuth }),
    ...(link.requiresAdmin === undefined ? {} : { requiresAdmin: link.requiresAdmin }),
  }));
}

export function valuesMatch(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function pageContentDefaults(): Record<PageAppearanceId, PageContentConfig> {
  return Object.fromEntries(PAGE_APPEARANCE_IDS.map((id) => [
    id,
    { ...PAGE_APPEARANCE_REGISTRY[id].defaultContent },
  ])) as Record<PageAppearanceId, PageContentConfig>;
}

export function managedDraftsFor(revisions: ManagedRevision[]): AppearancePanelState['managedDrafts'] {
  const next: AppearancePanelState['managedDrafts'] = {};
  for (const page of PAGE_APPEARANCE_IDS) {
    const revision = revisions.find((item) => item.pageKey === page && item.status === 'draft')
      ?? revisions.find((item) => item.pageKey === page && item.status === 'published');
    next[page] = revision?.document ?? { ...EMPTY_MANAGED_PAGE, blocks: [] };
  }
  return next;
}

export function initialAppearancePanelState(): AppearancePanelState {
  return {
    appearanceHistory: [],
    appearanceHistoryPage: { total: 0, nextCursor: null, hasNext: false },
    links: toEditableLinks(DEFAULT_NAV_LINKS),
    loading: true,
    managedDrafts: {},
    managedRevisions: [],
    message: null,
    pageContent: pageContentDefaults(),
    requestExternal: { ...DEFAULT_REQUEST_EXTERNAL_CONTENT },
    requestInternal: { ...DEFAULT_REQUEST_INTERNAL_CONTENT },
    saving: false,
    section: 'theme',
    selectedPage: 'home',
    theme: { ...DEFAULT_APPEARANCE_THEME },
  };
}

function hydratedPageContent(values: StoredValues): Record<PageAppearanceId, PageContentConfig> {
  return Object.fromEntries(PAGE_APPEARANCE_IDS.map((id) => {
    const registration = PAGE_APPEARANCE_REGISTRY[id];
    return [
      id,
      normalizeLegacyPageContent(
        id,
        parseStoredContent(String(values[registration.key] ?? ''), registration.defaultContent)
      ),
    ];
  })) as Record<PageAppearanceId, PageContentConfig>;
}

export function appearancePanelReducer(state: AppearancePanelState, action: AppearancePanelAction): AppearancePanelState {
  switch (action.type) {
    case 'addLink':
      return { ...state, links: [...state.links, { editorKey: newEditorKey(), label: 'New link', href: '/', section: 'main' }] };
    case 'hydrateConfig': {
      let theme = { ...DEFAULT_APPEARANCE_THEME };
      try {
        theme = { ...DEFAULT_APPEARANCE_THEME, ...JSON.parse(String(action.values['appearance.theme'] || '{}')) };
      } catch { /* use constrained defaults */ }
      return {
        ...state,
        links: parseStoredNav(String(action.values['nav.links'] ?? '')),
        pageContent: hydratedPageContent(action.values),
        requestExternal: parseStoredContent(String(action.values['pages.requestExternal'] ?? ''), DEFAULT_REQUEST_EXTERNAL_CONTENT),
        requestInternal: parseStoredContent(String(action.values['pages.requestInternal'] ?? ''), DEFAULT_REQUEST_INTERNAL_CONTENT),
        theme,
      };
    }
    case 'moveLink': {
      const index = state.links.findIndex((link) => link.editorKey === action.editorKey);
      const target = index + action.direction;
      if (index < 0 || target < 0 || target >= state.links.length) return state;
      const links = [...state.links];
      const current = links[index];
      const adjacent = links[target];
      if (!current || !adjacent) return state;
      links[index] = adjacent;
      links[target] = current;
      return { ...state, links };
    }
    case 'removeLink':
      return { ...state, links: state.links.filter((link) => link.editorKey !== action.editorKey) };
    case 'resetLinks':
      return { ...state, links: toEditableLinks(DEFAULT_NAV_LINKS) };
    case 'setAppearanceHistory':
      return {
        ...state,
        appearanceHistory: action.append ? [...state.appearanceHistory, ...action.items] : action.items,
        appearanceHistoryPage: action.pageInfo ?? state.appearanceHistoryPage,
      };
    case 'setLoading':
      return { ...state, loading: action.loading };
    case 'setManagedDraft':
      return { ...state, managedDrafts: { ...state.managedDrafts, [action.page]: action.document } };
    case 'setManagedRevisions':
      return { ...state, managedRevisions: action.revisions, managedDrafts: managedDraftsFor(action.revisions) };
    case 'setMessage':
      return { ...state, message: action.message };
    case 'setPageContent':
      return { ...state, pageContent: { ...state.pageContent, [action.page]: action.value } };
    case 'setRequestExternal':
      return { ...state, requestExternal: action.value };
    case 'setRequestInternal':
      return { ...state, requestInternal: action.value };
    case 'setSaving':
      return { ...state, saving: action.saving };
    case 'setSection':
      return { ...state, section: action.section };
    case 'setSelectedPage':
      return { ...state, selectedPage: action.page };
    case 'setTheme':
      return { ...state, theme: action.theme };
    case 'updateLink':
      return {
        ...state,
        links: state.links.map((link) => link.editorKey === action.editorKey ? { ...link, ...action.patch } : link),
      };
    default:
      return state;
  }
}
