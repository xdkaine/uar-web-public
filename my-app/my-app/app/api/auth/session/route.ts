import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/session';
import { searchLDAPUser } from '@/lib/ldap';

export async function GET(request: NextRequest) {
  const session = await getSessionFromRequest(request);

  if (!session) {
    return NextResponse.json({
      isAuthenticated: false,
      isAdmin: false
    });
  }

  // Fetch display name from Active Directory
  let displayName = session.username;
  try {
    const userInfo = await searchLDAPUser(session.username);
    if (userInfo) {
      // Prefer displayName, then cn, then fallback to username
      const displayNameAttr = userInfo.attributes.find(a => a.type === 'displayName');
      const cnAttr = userInfo.attributes.find(a => a.type === 'cn');
      displayName = displayNameAttr?.values[0] || cnAttr?.values[0] || session.username;
    }
  } catch (error) {
    // Fallback to username if AD lookup fails
    console.error('Failed to fetch display name from AD:', error);
  }

  return NextResponse.json({
    isAuthenticated: true,
    isAdmin: session.isAdmin,
    username: session.username,
    displayName,
  });
}
