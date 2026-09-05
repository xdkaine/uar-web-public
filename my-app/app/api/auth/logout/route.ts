import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { clearSession, getSessionCookieName, revokeSessionByToken } from '@/lib/session';
import { recordProviderLogoutOutcome } from '@/lib/auth/provider-logout-audit';
import { getIpAddress, getUserAgent } from '@/lib/audit-log';

export async function POST(request: NextRequest) {
  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;

  // Capture the provider session link before the portal row is deleted.
  const revoked = await revokeSessionByToken(token, 'user_logout');

  // Full logout (ADR-0012): destroy the IdP session too so the next login
  // re-prompts for credentials instead of silently SSOing back in. Capped
  // wait keeps logout responsive; failure only logs - never blocks.
  // The ACTUAL outcome is now also written to the audit log (ADR-0014).
  await recordProviderLogoutOutcome({
    surface: 'user_self',
    username: null,
    sessionId: null,
    isAdmin: false,
    hadSession: Boolean(revoked),
    providerSid: revoked?.providerSid,
    providerLogoutTaskId: revoked?.providerLogoutTaskId,
    ipAddress: getIpAddress(request),
    userAgent: getUserAgent(request),
  });

  const response = NextResponse.json({ success: true });

  clearSession(response);

  return response;
}
