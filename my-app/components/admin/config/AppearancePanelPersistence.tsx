'use client';

import { fetchWithCsrf } from '@/lib/csrf';
import {
  DEFAULT_APPEARANCE_THEME,
  DEFAULT_NAV_LINKS,
  DEFAULT_REQUEST_EXTERNAL_CONTENT,
  DEFAULT_REQUEST_INTERNAL_CONTENT,
  PAGE_APPEARANCE_IDS,
  PAGE_APPEARANCE_REGISTRY,
  type PageAppearanceId,
} from '@/lib/appearance';
import { EMPTY_MANAGED_PAGE } from '@/lib/appearance-pages';
import { revalidateAppearance } from '@/lib/use-appearance';

import {
  normalizeLinks,
  persistedLinks,
  type AppearanceDispatch,
  type AppearancePanelState,
  valuesMatch,
} from './AppearancePanelState';

interface PersistenceDependencies {
  dispatch: AppearanceDispatch;
  loadAppearanceHistory: (cursor?: string) => Promise<void>;
  loadManagedPages: () => Promise<void>;
  state: AppearancePanelState;
}

export async function saveAppearance({ dispatch, state }: PersistenceDependencies): Promise<void> {
  dispatch({ type: 'setSaving', saving: true });
  dispatch({ type: 'setMessage', message: null });
  try {
    const expectedPages = Object.fromEntries(PAGE_APPEARANCE_IDS.map((id) => [
      id,
      id === 'requestInternal'
        ? state.requestInternal
        : id === 'requestExternal'
          ? state.requestExternal
          : state.pageContent[id],
    ]));
    const navCustomized = JSON.stringify(normalizeLinks(state.links)) !== JSON.stringify(normalizeLinks(DEFAULT_NAV_LINKS));
    const response = await fetchWithCsrf('/api/admin/config/appearance', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        values: {
          'appearance.theme': JSON.stringify(state.theme) === JSON.stringify(DEFAULT_APPEARANCE_THEME) ? null : JSON.stringify(state.theme),
          'nav.links': !navCustomized ? null : JSON.stringify(persistedLinks(state.links)),
          'pages.requestInternal': JSON.stringify(state.requestInternal) === JSON.stringify(DEFAULT_REQUEST_INTERNAL_CONTENT) ? null : JSON.stringify(state.requestInternal),
          'pages.requestExternal': JSON.stringify(state.requestExternal) === JSON.stringify(DEFAULT_REQUEST_EXTERNAL_CONTENT) ? null : JSON.stringify(state.requestExternal),
          ...Object.fromEntries(PAGE_APPEARANCE_IDS
            .filter((id) => id !== 'requestInternal' && id !== 'requestExternal')
            .map((id) => {
              const registration = PAGE_APPEARANCE_REGISTRY[id];
              const value = state.pageContent[id];
              return [registration.key, JSON.stringify(value) === JSON.stringify(registration.defaultContent) ? null : JSON.stringify(value)];
            })),
        },
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to save appearance');
    const publicData = await revalidateAppearance();
    if (
      !valuesMatch(publicData.theme, state.theme)
      || !valuesMatch(normalizeLinks(publicData.navLinks ?? []), normalizeLinks(state.links))
      || !valuesMatch(publicData.pages, expectedPages)
    ) {
      throw new Error('The change was saved, but public read-back did not match every field. Refresh before retrying.');
    }
    window.dispatchEvent(new CustomEvent('uar:appearance-updated'));
    dispatch({ type: 'setMessage', message: { type: 'success', text: 'Appearance saved and verified on the public portal.' } });
  } catch (error) {
    dispatch({ type: 'setMessage', message: { type: 'error', text: error instanceof Error ? error.message : 'Failed to save' } });
  } finally {
    dispatch({ type: 'setSaving', saving: false });
  }
}

export async function saveManagedPage(action: 'save' | 'publish', dependencies: PersistenceDependencies): Promise<void> {
  const { dispatch, loadManagedPages, state } = dependencies;
  const document = state.managedDrafts[state.selectedPage] ?? EMPTY_MANAGED_PAGE;
  const currentDraft = state.managedRevisions.find((item) => item.pageKey === state.selectedPage && item.status === 'draft');
  dispatch({ type: 'setSaving', saving: true });
  dispatch({ type: 'setMessage', message: null });
  try {
    if (action === 'save') {
      const response = await fetchWithCsrf('/api/admin/config/appearance/pages', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageKey: state.selectedPage, document, expectedUpdatedAt: currentDraft?.updatedAt ?? null }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to save page draft');
      dispatch({ type: 'setMessage', message: { type: 'success', text: `${PAGE_APPEARANCE_REGISTRY[state.selectedPage].label} draft saved.` } });
    } else {
      const response = await fetchWithCsrf('/api/admin/config/appearance/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageKey: state.selectedPage, action: 'publish', expectedUpdatedAt: currentDraft?.updatedAt ?? null }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to publish page');
      const publicData = await revalidateAppearance();
      if (!valuesMatch(publicData.managedPages?.[state.selectedPage], document)) {
        throw new Error('The revision was published, but public read-back did not match. Refresh before retrying.');
      }
      dispatch({ type: 'setMessage', message: { type: 'success', text: `${PAGE_APPEARANCE_REGISTRY[state.selectedPage].label} published.` } });
      window.dispatchEvent(new CustomEvent('uar:appearance-updated'));
    }
    await loadManagedPages();
  } catch (error) {
    dispatch({ type: 'setMessage', message: { type: 'error', text: error instanceof Error ? error.message : 'Page update failed' } });
  } finally {
    dispatch({ type: 'setSaving', saving: false });
  }
}

export async function restoreManagedPage(pageKey: PageAppearanceId, version: number, dependencies: PersistenceDependencies): Promise<void> {
  const { dispatch, loadAppearanceHistory, loadManagedPages, state } = dependencies;
  dispatch({ type: 'setSaving', saving: true });
  dispatch({ type: 'setMessage', message: null });
  try {
    const currentDraft = state.managedRevisions.find((item) => item.pageKey === pageKey && item.status === 'draft');
    const response = await fetchWithCsrf('/api/admin/config/appearance/pages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pageKey, action: 'restore', version, expectedUpdatedAt: currentDraft?.updatedAt ?? null }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to restore page');
    dispatch({ type: 'setSelectedPage', page: pageKey });
    dispatch({ type: 'setSection', section: 'pages' });
    dispatch({ type: 'setMessage', message: { type: 'success', text: `Version ${version} restored as a new draft.` } });
    await Promise.all([loadManagedPages(), loadAppearanceHistory()]);
  } catch (error) {
    dispatch({ type: 'setMessage', message: { type: 'error', text: error instanceof Error ? error.message : 'Failed to restore page' } });
  } finally {
    dispatch({ type: 'setSaving', saving: false });
  }
}

export async function restoreRevision(revisionId: string, dependencies: PersistenceDependencies): Promise<void> {
  const { dispatch, loadAppearanceHistory } = dependencies;
  dispatch({ type: 'setSaving', saving: true });
  dispatch({ type: 'setMessage', message: null });
  try {
    const response = await fetchWithCsrf('/api/admin/config/appearance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ revisionId }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Failed to restore revision');
    const publicData = await revalidateAppearance();
    if (!result.pageId || !valuesMatch(publicData.pages?.[result.pageId as PageAppearanceId], result.expected)) {
      throw new Error('The revision was restored, but public read-back did not match. Refresh before retrying.');
    }
    dispatch({ type: 'setMessage', message: { type: 'success', text: `Restored ${result.restored}. Reloading the editor…` } });
    await loadAppearanceHistory();
    window.setTimeout(() => window.location.reload(), 500);
  } catch (error) {
    dispatch({ type: 'setMessage', message: { type: 'error', text: error instanceof Error ? error.message : 'Failed to restore revision' } });
    dispatch({ type: 'setSaving', saving: false });
  }
}
