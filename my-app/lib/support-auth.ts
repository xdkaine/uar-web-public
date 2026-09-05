import { NextResponse } from 'next/server';
import { resolveAnyRoleForSession } from '@/lib/adminAuth';
import { getSessionFromCookies } from '@/lib/session';
import type { PermissionKey } from '@/lib/rbac/permissions';

export interface SupportAuthResult {
  username: string;
  isAdmin: boolean;
  permissions: Set<PermissionKey>;
}

/**
 * Permission-aware re-verification for support surfaces. AD sessions resolve
 * current privilege mappings; local sessions must still map to an active
 * break-glass account. A denied mapped operator keeps their valid session.
 */
export async function checkSupportAuth(): Promise<{
  auth: SupportAuthResult | null;
  response?: NextResponse;
}> {
  const session = await getSessionFromCookies();

  if (!session) {
    return { auth: null };
  }

  if (!session.isAdmin) {
    return {
      auth: {
        username: session.username,
        isAdmin: false,
        permissions: new Set(),
      },
    };
  }

  const authorization = await resolveAnyRoleForSession(session);
  if (!authorization) return { auth: null, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

  return {
    auth: {
      username: session.username,
      isAdmin: true,
      permissions: authorization.permissions,
    },
  };
}

export function supportAuthHasPermission(auth: SupportAuthResult, permission: PermissionKey): boolean {
  return !auth.isAdmin || Boolean(auth.permissions?.has(permission));
}
