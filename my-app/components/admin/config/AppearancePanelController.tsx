'use client';

import { useReducer } from 'react';
import useSWR from 'swr';

import { fetchJson } from '@/lib/client-query';
import type { NavLinkConfig, PageAppearanceId, PageContentConfig } from '@/lib/appearance';
import type { ManagedPageDocument } from '@/lib/appearance-pages';

import {
  appearancePanelReducer,
  initialAppearancePanelState,
  type AppearanceHistoryItem,
  type AppearancePanelState,
  type AppearanceSection,
  type ManagedRevision,
  type StoredValues,
} from './AppearancePanelState';
import {
  restoreManagedPage,
  restoreRevision,
  saveAppearance,
  saveManagedPage,
} from './AppearancePanelPersistence';

type AppearanceHistoryPage = { total: number; nextCursor: string | null; hasNext: boolean };

export function useAppearancePanelController() {
  const [state, dispatch] = useReducer(appearancePanelReducer, undefined, initialAppearancePanelState);

  const loadManagedPages = async () => {
    try {
      const response = await fetch('/api/admin/config/appearance/pages');
      if (!response.ok) return;
      const data = await response.json() as { revisions?: ManagedRevision[] };
      dispatch({ type: 'setManagedRevisions', revisions: data.revisions ?? [] });
    } catch { /* appearance copy remains available */ }
  };

  const loadAppearanceHistory = async (cursor?: string) => {
    const response = await fetch(`/api/admin/config/appearance/history?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { cache: 'no-store' });
    if (!response.ok) return;
    const data = await response.json() as { items?: AppearanceHistoryItem[]; pageInfo?: AppearanceHistoryPage };
    dispatch({
      type: 'setAppearanceHistory',
      items: Array.isArray(data.items) ? data.items : [],
      pageInfo: data.pageInfo,
      append: Boolean(cursor),
    });
  };

  useSWR<StoredValues>('/api/admin/config/appearance', fetchJson, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    onSuccess: (data) => {
      dispatch({ type: 'hydrateConfig', values: data });
      dispatch({ type: 'setLoading', loading: false });
    },
    onError: () => dispatch({ type: 'setLoading', loading: false }),
  });

  useSWR<{ revisions?: ManagedRevision[] }>('/api/admin/config/appearance/pages', fetchJson, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    onSuccess: (data) => dispatch({ type: 'setManagedRevisions', revisions: data.revisions ?? [] }),
  });

  useSWR<{ items?: AppearanceHistoryItem[]; pageInfo?: AppearanceHistoryPage }>(
    '/api/admin/config/appearance/history?limit=20',
    fetchJson,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      onSuccess: (data) => dispatch({
        type: 'setAppearanceHistory',
        items: Array.isArray(data.items) ? data.items : [],
        pageInfo: data.pageInfo,
        append: false,
      }),
    }
  );

  const persistence = { dispatch, loadAppearanceHistory, loadManagedPages, state };
  return {
    state,
    addLink: () => dispatch({ type: 'addLink' }),
    loadAppearanceHistory,
    moveLink: (editorKey: string, direction: -1 | 1) => dispatch({ type: 'moveLink', editorKey, direction }),
    removeLink: (editorKey: string) => dispatch({ type: 'removeLink', editorKey }),
    resetLinks: () => dispatch({ type: 'resetLinks' }),
    restoreManagedPage: (page: PageAppearanceId, version: number) => restoreManagedPage(page, version, persistence),
    restoreRevision: (revisionId: string) => restoreRevision(revisionId, persistence),
    save: () => saveAppearance(persistence),
    saveManagedPage: (action: 'save' | 'publish') => saveManagedPage(action, persistence),
    setManagedDraft: (page: PageAppearanceId, document: ManagedPageDocument) => dispatch({ type: 'setManagedDraft', page, document }),
    setPageContent: (page: PageAppearanceId, value: PageContentConfig) => dispatch({ type: 'setPageContent', page, value }),
    setRequestExternal: (value: PageContentConfig) => dispatch({ type: 'setRequestExternal', value }),
    setRequestInternal: (value: PageContentConfig) => dispatch({ type: 'setRequestInternal', value }),
    setSection: (section: AppearanceSection) => dispatch({ type: 'setSection', section }),
    setSelectedPage: (page: PageAppearanceId) => dispatch({ type: 'setSelectedPage', page }),
    setTheme: (theme: AppearancePanelState['theme']) => dispatch({ type: 'setTheme', theme }),
    updateLink: (editorKey: string, patch: Partial<NavLinkConfig>) => dispatch({ type: 'updateLink', editorKey, patch }),
  };
}
