'use client';

import { useSyncExternalStore } from 'react';
import type {
  AppearanceThemeConfig,
  NavLinkConfig,
  PageAppearanceId,
  PageContentConfig,
} from '@/lib/appearance';
import type { ManagedPageDocument } from '@/lib/appearance-pages';

export const APPEARANCE_UPDATED_EVENT = 'uar:appearance-updated';
const APPEARANCE_CHANNEL = 'uar:appearance';

export interface AppearanceData {
  appearanceVersion?: string;
  requestInternal?: PageContentConfig;
  requestExternal?: PageContentConfig;
  pages?: Partial<Record<PageAppearanceId, PageContentConfig>>;
  managedPages?: Partial<Record<PageAppearanceId, ManagedPageDocument>>;
  theme?: AppearanceThemeConfig;
  navLinks?: NavLinkConfig[];
}

const EMPTY_APPEARANCE: AppearanceData = {};
let snapshot: AppearanceData = EMPTY_APPEARANCE;
let etag: string | null = null;
let inflight: Promise<AppearanceData> | null = null;
let browserListenersInstalled = false;
const listeners = new Set<() => void>();

function emitChange() {
  for (const listener of listeners) listener();
}

async function fetchAppearance(force = false): Promise<AppearanceData> {
  if (inflight) return inflight;
  if (!force && snapshot !== EMPTY_APPEARANCE) return snapshot;

  inflight = fetch('/api/config/appearance', {
    cache: 'no-store',
    headers: etag ? { 'If-None-Match': etag } : undefined,
  })
    .then(async (response) => {
      if (response.status === 304) return snapshot;
      if (!response.ok) throw new Error('Appearance configuration is unavailable');
      const next = (await response.json()) as AppearanceData;
      etag = response.headers.get('etag');
      snapshot = next;
      emitChange();
      return snapshot;
    })
    .catch(() => snapshot)
    .finally(() => {
      inflight = null;
    });

  return inflight;
}

export function revalidateAppearance(): Promise<AppearanceData> {
  return fetchAppearance(true);
}

function installBrowserListeners() {
  if (browserListenersInstalled || typeof window === 'undefined') return;
  browserListenersInstalled = true;

  const channel = typeof BroadcastChannel === 'undefined'
    ? null
    : new BroadcastChannel(APPEARANCE_CHANNEL);

  window.addEventListener(APPEARANCE_UPDATED_EVENT, () => {
    channel?.postMessage({ type: 'published' });
    void revalidateAppearance();
  });
  channel?.addEventListener('message', () => {
    void revalidateAppearance();
  });
  window.addEventListener('focus', () => {
    void revalidateAppearance();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void revalidateAppearance();
  });
}

function subscribe(listener: () => void) {
  installBrowserListeners();
  listeners.add(listener);
  void fetchAppearance();
  return () => listeners.delete(listener);
}

/**
 * Shared public appearance state. Consumers keep the last verified snapshot
 * while revalidating, so an editor publish never flashes back to defaults.
 */
export function useAppearance(): AppearanceData {
  return useSyncExternalStore(subscribe, () => snapshot, () => EMPTY_APPEARANCE);
}
