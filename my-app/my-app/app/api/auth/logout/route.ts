import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { clearSession, getSessionCookieName, revokeSessionByToken } from '@/lib/session';

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(getSessionCookieName())?.value;

  await revokeSessionByToken(token);

  const response = NextResponse.json({ success: true });

  clearSession(response);

  return response;
}
