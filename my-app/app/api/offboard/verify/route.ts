import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimitAsync, getClientIp, RateLimitPresets } from '@/lib/ratelimit';

function redirectTo(path: string) {
  return new NextResponse(null, {
    status: 302,
    headers: { Location: path },
  });
}

export async function GET(request: NextRequest) {
  try {
    const clientIp = getClientIp(request);
    const rateLimitResult = await checkRateLimitAsync(clientIp, RateLimitPresets.general);
    if (!rateLimitResult.success) {
      return redirectTo('/offboard/verify/error?reason=rate_limit');
    }

    const token = request.nextUrl.searchParams.get('token');
    if (!token) {
      return redirectTo('/offboard/verify/error?reason=missing_token');
    }

    return redirectTo(`/offboard/verify/confirm?token=${encodeURIComponent(token)}`);
  } catch {
    return redirectTo('/offboard/verify/error');
  }
}
