import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { CSRF_HEADER_NAME, csrfCookieOptions } from '@/lib/csrf-cookie-policy';
import { getSessionFromRequest } from '@/lib/session';
import { checkRateLimitAsync, getClientIp } from '@/lib/ratelimit';

export const dynamic = 'force-dynamic';

function generateCsrfToken(sessionId: string): string {
  const secret = process.env.NEXTAUTH_SECRET || process.env.ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error('NEXTAUTH_SECRET or ENCRYPTION_SECRET must be set for CSRF token generation');
  }

  const hmac = crypto.createHmac('sha256', secret);
  // Remove timestamp to make the token stable for the session duration
  // This prevents issues with multiple tabs or token refreshes invalidating previous tokens
  hmac.update(sessionId);
  const signature = hmac.digest('hex');

  return signature;
}

export async function GET(request: NextRequest) {
  // Apply rate limiting: 100 requests per minute per IP
  const clientIp = getClientIp(request);
  const rateLimitResult = await checkRateLimitAsync(clientIp, {
    maxRequests: 100,
    windowMs: 60 * 1000,
  });

  if (!rateLimitResult.success) {
    return NextResponse.json(
      { error: 'Too many requests. Please try again later.' },
      { status: 429 }
    );
  }

  const session = await getSessionFromRequest(request);

  if (!session) {
    const genericToken = crypto.randomBytes(32).toString('hex');
    const response = NextResponse.json({ csrfToken: genericToken });

    response.cookies.set(csrfCookieOptions(genericToken));

    response.headers.set(CSRF_HEADER_NAME, genericToken);
    return response;
  }

  const csrfToken = generateCsrfToken(session.id);

  const response = NextResponse.json({ csrfToken });

  response.cookies.set(csrfCookieOptions(csrfToken));

  response.headers.set(CSRF_HEADER_NAME, csrfToken);

  return response;
}
