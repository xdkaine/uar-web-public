'use client';

import { useEffect } from 'react';

/**
 * Hook to track page views in the admin panel
 * This endpoint is CSRF-exempt as it's already protected by session authentication.
 * @param pageName The name of the page/tab being viewed
 * @param category The category of the page (e.g., 'navigation', 'access_request', etc.)
 */
export function useAdminPageTracking(pageName: string, category: string) {
  useEffect(() => {
    // sendBeacon is designed for fire-and-forget telemetry and survives page
    // transitions without leaving an in-flight fetch tied to this component.
    navigator.sendBeacon(
      '/api/admin/track-view',
      new Blob([JSON.stringify({ pageName, category })], { type: 'application/json' })
    );
  }, [pageName, category]);
}
