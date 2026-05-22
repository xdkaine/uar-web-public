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
    // Track page view - fire and forget
    const trackPageView = async () => {
      try {
        await fetch('/api/admin/track-view', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            pageName,
            category,
          }),
        });
      } catch (error) {
        // Silently fail - tracking is non-critical and shouldn't interrupt user experience
        if (process.env.NODE_ENV === 'development') {
          console.debug('Failed to track page view:', error);
        }
      }
    };

    trackPageView();
  }, [pageName, category]);
}
