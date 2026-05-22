import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendAdminNotification } from '@/lib/email';
import { checkRateLimitAsync, getClientIp, RateLimitPresets } from '@/lib/ratelimit';

// GET route - redirects to confirmation page (prevents email scanner auto-verification)
export async function GET(request: NextRequest) {
  try {
    // Use the configured app URL for redirects
    const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://portal.calpolysoc.org';

    const clientIp = getClientIp(request);
    const rateLimitResult = await checkRateLimitAsync(clientIp, RateLimitPresets.general);

    if (!rateLimitResult.success) {
      return NextResponse.redirect(new URL('/verify/error?reason=rate_limit', origin));
    }
    
    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get('token');

    if (!token) {
      return NextResponse.redirect(new URL('/verify/error', origin));
    }

    // Redirect to confirmation page - this prevents email scanners from auto-verifying
    // User must click the button on the confirm page to actually verify
    return NextResponse.redirect(new URL(`/verify/confirm?token=${encodeURIComponent(token)}`, origin));
  } catch (error) {
    console.error('Error in verify GET:', error);
    const origin = process.env.NEXT_PUBLIC_APP_URL || 'https://portal.calpolysoc.org';
    return NextResponse.redirect(new URL('/verify/error', origin));
  }
}
