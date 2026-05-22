import { NextResponse } from 'next/server';

export function secureJsonResponse<T>(
  data: T,
  status: number = 200,
  additionalHeaders?: Record<string, string>
): NextResponse {
  const response = NextResponse.json(data, { status });

  response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  response.headers.set('Pragma', 'no-cache');
  response.headers.set('Expires', '0');

  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');

  if (additionalHeaders) {
    Object.entries(additionalHeaders).forEach(([key, value]) => {
      response.headers.set(key, value);
    });
  }
  
  return response;
}

export function secureErrorResponse(
  error: string,
  status: number = 500,
  details?: Record<string, unknown>
): NextResponse {
  return secureJsonResponse(
    { error, ...details },
    status
  );
}

export function secureSuccessResponse(
  message: string,
  data?: Record<string, unknown>,
  status: number = 200
): NextResponse {
  return secureJsonResponse(
    { message, ...data },
    status
  );
}

export function rateLimitResponse(
  resetTime: number,
  limit: number,
  remaining: number
): NextResponse {
  const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
  
  const response = secureErrorResponse(
    'Too many requests. Please try again later.',
    429,
    { retryAfter }
  );
  
  response.headers.set('X-RateLimit-Limit', limit.toString());
  response.headers.set('X-RateLimit-Remaining', remaining.toString());
  response.headers.set('X-RateLimit-Reset', new Date(resetTime).toISOString());
  response.headers.set('Retry-After', retryAfter.toString());
  
  return response;
}
