import { NextRequest, NextResponse } from 'next/server';
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
  csrfCookieOptions,
  shouldRefreshCsrfCookie,
  validateCsrfTokenPair,
} from './lib/csrf-cookie-policy';
import { isCsrfExempt, requiresCsrfValidation } from './lib/csrf-config';
import { SESSION_COOKIE_NAME } from './lib/session-cookie-policy';

// Winston is not compatible with Edge Runtime, so we define a lightweight 
// console-based logger for middleware that mimics the JSON structure.
const edgeLogger = {
  info: (message: string, meta?: Record<string, unknown>) => {
    const logEntry = {
      level: 'info',
      message,
      service: 'uar-web',
      timestamp: new Date().toISOString(),
      type: 'access_log',
      ...meta
    };
    console.log(JSON.stringify(logEntry));
  }
};

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Log all incoming requests
  edgeLogger.info('Incoming Request', {
    method: request.method,
    pathname,
    ip: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
    userAgent: request.headers.get('user-agent'),
  });

  // Server layouts do not receive the resolved pathname as a prop. Set this
  // from the request URL here (rather than trusting a client header) so the
  // admin layout can enforce the same capability manifest before a page's
  // client panel mounts.
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set('x-uar-admin-pathname', pathname);
  const response = NextResponse.next({ request: { headers: forwardedHeaders } });

  // Protect admin pages - require session cookie to be present
  // Full session validation happens in API routes, but this prevents
  // unauthenticated users from even loading admin pages
  if (pathname.startsWith('/admin') && !pathname.startsWith('/api/')) {
    const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);
    if (!sessionCookie?.value) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Skip CSRF validation for exempt paths (defined in csrf-config.ts)
  if (isCsrfExempt(pathname)) {
    // Continue to headers
  } else if (pathname.startsWith('/api/admin/') && request.method === 'GET') {
    // Skip CSRF for admin GET requests - read-only operations
    // These are already protected by session authentication in checkAdminAuthWithRateLimit()
    // CSRF protection is unnecessary for operations that don't modify state
  } else if (requiresCsrfValidation(request.method)) {
    const csrfTokenFromHeader = request.headers.get(CSRF_HEADER_NAME);
    const csrfTokenFromCookie = request.cookies.get(CSRF_COOKIE_NAME)?.value;

    if (!validateCsrfTokenPair(csrfTokenFromHeader, csrfTokenFromCookie)) {
      console.error('CSRF validation failed for:', pathname);

      if (process.env.NODE_ENV !== 'production') {
        console.debug(
          'Header token snippet:',
          csrfTokenFromHeader ? `${csrfTokenFromHeader.substring(0, 20)}...` : 'missing'
        );
        console.debug(
          'Cookie token snippet:',
          csrfTokenFromCookie ? `${csrfTokenFromCookie.substring(0, 20)}...` : 'missing'
        );
      }
      return NextResponse.json(
        { error: 'Invalid CSRF token' },
        { status: 403 }
      );
    }
  }

  // Handle CSRF cookie rotation for GET requests
  // Skip for /api/csrf-token as it sets its own fresh cookie
  if (shouldRefreshCsrfCookie(request.method, pathname)) {
    const csrfCookie = request.cookies.get(CSRF_COOKIE_NAME);
    if (csrfCookie?.value) {
      response.cookies.set(csrfCookieOptions(csrfCookie.value));
    }
  }

  // Add Security Headers to all responses (API and Pages)
  // These provide defense-in-depth even if next.config.ts misses some
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // HSTS is usually handled by the host/next.config.ts but good to enforce
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
  }

  return response;
}

export const config = {
  matcher: ['/api/:path*', '/admin/:path*']
};
