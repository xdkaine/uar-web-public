import { NextRequest, NextResponse } from 'next/server';
import { getSessionFromRequest } from '@/lib/session';
import { searchLDAPUser } from '@/lib/ldap';
import { resolveAnyRoleForSession } from '@/lib/adminAuth';

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

  let roles: string[] = [];
  let permissions: string[] = [];
  if (session.isAdmin) {
    try {
      // Provider-aware resolution (ADR-0009): local break-glass sessions get
      // their authorization without any directory call, so the UI still
      // shows effective permissions during a directory outage.
      const authorization = await resolveAnyRoleForSession(session);
      if (authorization) {
        roles = [...authorization.roles];
        permissions = [...authorization.permissions].sort();
      }
    } catch (error) {
      console.error('Failed to resolve authorization for session:', error);
    }
  }

  return NextResponse.json({
    isAuthenticated: true,
    isAdmin: session.isAdmin,
    username: session.username,
    displayName,
    roles,
    permissions,
  });
}
