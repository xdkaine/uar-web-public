import { isCsrfExempt } from './csrf-config';

const CSRF_COOKIE_NAME = 'csrf-token';

let cachedCsrfToken: string | null = null;
let refreshPromise: Promise<string | null> | null = null;

function cacheToken(token: string | null) {
  cachedCsrfToken = token;
}

export function invalidateCsrfTokenCache() {
  cachedCsrfToken = null;
}

/**
 * Utility function to get CSRF token from cookie or cache.
 * The live cookie is authoritative when readable; the memory cache covers
 * httpOnly deployments where document.cookie cannot expose the value.
 */
export function getCsrfToken(): string | null {
  if (typeof document !== 'undefined') {
    const match = document.cookie.match(
      new RegExp(`(?:^|;\\s*)${CSRF_COOKIE_NAME}=([^;]*)`)
    );
    const liveValue = match ? match[1] : null;
    if (liveValue) {
      if (cachedCsrfToken && cachedCsrfToken !== liveValue) {
        // The server rotated the cookie (new session, re-issue): trust the
        // freshest value and drop the stale memory copy silently.
        cacheToken(liveValue);
      }
      return liveValue;
    }
  }
  return cachedCsrfToken;
}

async function ensureCsrfToken(forceRefresh = false): Promise<string | null> {
  if (typeof window === 'undefined') {
    return null;
  }

  if (forceRefresh) {
    cacheToken(null);
  } else {
    const existing = getCsrfToken();
    if (existing) {
      return existing;
    }
  }

  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const response = await fetch('/api/csrf-token', {
          method: 'GET',
          headers: {
            'cache-control': 'no-store',
          },
        });

        if (!response.ok) {
          console.error(
            'Failed to refresh CSRF token. Server responded with status',
            response.status
          );
          return null;
        }

        let token: string | null = null;

        try {
          const data = await response.json();
          if (data && typeof data.csrfToken === 'string') {
            token = data.csrfToken;
          }
        } catch {
          token = null;
        }

        if (!token) {
          token = response.headers.get('x-csrf-token');
        }

        cacheToken(token || null);
        return cachedCsrfToken;
      } catch (error) {
        console.error('Failed to refresh CSRF token:', error);
        return null;
      } finally {
        refreshPromise = null;
      }
    })();
  }

  return refreshPromise;
}

/**
 * Enhanced fetch wrapper that automatically includes CSRF token.
 * Use this for all API requests that modify data (POST, PUT, DELETE, PATCH).
 * Automatically skips CSRF token for exempt paths (e.g., logout).
 * Handles 401 Unauthorized responses by redirecting to login page.
 */
export async function fetchWithCsrf(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const method = options.method?.toUpperCase() || 'GET';
  
  // Share the server's exemption policy so browser and middleware cannot drift.
  const needsCsrf = 
    ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method) &&
    !isUrlCsrfExempt(url);
  
  let csrfToken: string | null = null;

  if (needsCsrf) {
    if (typeof window !== 'undefined') {
      csrfToken = await ensureCsrfToken();
    } else {
      csrfToken = getCsrfToken();
    }
  }

  const response = await sendWithCsrfHeader(url, options, csrfToken);

  // Self-healing: a 403 CSRF rejection means our notion of the token drifted
  // from the server's cookie (session change, expiry race, multi-tab).
  // Refresh once and retry the mutation with the fresh token before giving up.
  if (
    needsCsrf &&
    response.status === 403 &&
    (await isInvalidCsrfRejection(response))
  ) {
    invalidateCsrfTokenCache();
    const refreshed = await ensureCsrfToken(true);
    if (refreshed) {
      return sendWithCsrfHeader(url, options, refreshed);
    }
  }

  // Global 401 error handler - redirect to login with return URL
  if (response.status === 401 && typeof window !== 'undefined') {
    // Don't redirect if we're already on login/logout pages or if this is a login/session check request
    const currentPath = window.location.pathname;
    const isAuthPage = currentPath.startsWith('/login') || 
                       currentPath.startsWith('/forgot-password') ||
                       currentPath.startsWith('/reset-password');
    const isAuthCheckRequest = url.includes('/api/auth/session') || 
                               url.includes('/api/auth/login') ||
                               url.includes('/api/auth/logout');
    
    if (!isAuthPage && !isAuthCheckRequest) {
      // Save current page to redirect back after login
      const redirectUrl = encodeURIComponent(currentPath + window.location.search);
      window.location.href = `/login?redirect=${redirectUrl}`;
    }
  }

  return response;
}

function sendWithCsrfHeader(
  url: string,
  options: RequestInit,
  csrfToken: string | null
): Promise<Response> {
  let requestInit = options;
  if (csrfToken) {
    let existingHeaders: Record<string, string> = {};
    if (options.headers instanceof Headers) {
      options.headers.forEach((value, key) => {
        existingHeaders[key] = value;
      });
    } else if (Array.isArray(options.headers)) {
      existingHeaders = Object.fromEntries(options.headers);
    } else {
      existingHeaders = { ...(options.headers ?? {}) };
    }
    requestInit = {
      ...options,
      headers: {
        ...existingHeaders,
        'x-csrf-token': csrfToken,
      },
    };
  }
  return fetch(url, requestInit);
}

async function isInvalidCsrfRejection(response: Response): Promise<boolean> {
  try {
    const data = await response.clone().json();
    return typeof data?.error === 'string' && /csrf/i.test(data.error);
  } catch {
    return false;
  }
}

/**
 * Check if a URL is exempt from CSRF validation.
 * Handles both relative and absolute URLs.
 */
function isUrlCsrfExempt(url: string): boolean {
  try {
    // Extract pathname from URL (handle both relative and absolute URLs)
    let pathname: string;
    
    if (url.startsWith('http://') || url.startsWith('https://')) {
      pathname = new URL(url).pathname;
    } else if (url.startsWith('/')) {
      pathname = url.split('?')[0]; // Remove query string if present
    } else {
      // Relative URL without leading slash
      pathname = '/' + url.split('?')[0];
    }

    return isCsrfExempt(pathname);
  } catch {
    // If URL parsing fails, assume it needs CSRF for safety
    return false;
  }
}

/**
 * Refresh CSRF token by making a request to the server.
 * Call this on page load or when needed.
 */
export async function refreshCsrfToken(forceRefresh = false): Promise<void> {
  await ensureCsrfToken(forceRefresh);
}
