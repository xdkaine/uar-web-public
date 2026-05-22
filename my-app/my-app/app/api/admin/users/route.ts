import { NextRequest, NextResponse } from 'next/server';
import { listUsersInOU } from '@/lib/ldap';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { getAccountVerificationMap, normalizeOffboardIdentifier } from '@/lib/offboard-campaign';

type LdapDirectoryUser = Awaited<ReturnType<typeof listUsersInOU>>[number];

interface VpnDetails {
  status: string;
  portalType: string;
}

interface AdminUserListItem extends LdapDirectoryUser {
  vpnDetails: VpnDetails | null;
  lastVerifiedAt?: Date | null;
  lastVerifiedSource?: string;
  originalRegistrationAt?: Date | null;
}

export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const query = (searchParams.get('q') || '').trim().toLowerCase();
    const requestedLimit = Number(searchParams.get('limit') || 0);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : null;
    const includeVpnOnly = searchParams.get('includeVpnOnly') !== 'false';

    const [ldapUsers, vpnAccounts] = await Promise.all([
      listUsersInOU(),
      prisma.vPNAccount.findMany({
        select: {
          username: true,
          status: true,
          portalType: true,
          email: true,
        }
      })
    ]);

    // Create a map of all unique usernames
    const userMap = new Map<string, AdminUserListItem>();

    // Process LDAP users
    ldapUsers.forEach((user) => {
      userMap.set(user.username.toLowerCase(), {
        ...user,
        vpnDetails: null
      });
    });

    // Process VPN accounts
    vpnAccounts.forEach((vpn) => {
      const usernameLower = vpn.username.toLowerCase();
      const existing = userMap.get(usernameLower);

      if (existing) {
        existing.vpnDetails = {
          status: vpn.status,
          portalType: vpn.portalType
        };
      } else if (includeVpnOnly) {
        // VPN-only user (e.g. external)
        userMap.set(usernameLower, {
          username: vpn.username,
          displayName: vpn.username, // Fallback
          email: vpn.email ?? '',
          dn: '',
          description: 'VPN Account',
          accountEnabled: vpn.status === 'active',
          accountExpires: null,
          whenCreated: '',
          memberOf: [],
          vpnDetails: {
            status: vpn.status,
            portalType: vpn.portalType
          }
        });
      }
    });

    let users = Array.from(userMap.values());
    if (query) {
      users = users.filter((user) => (
        [user.username, user.displayName || '', user.email || '', user.description || '']
          .some((value) => value.toLowerCase().includes(query))
      ));
    }
    if (limit) {
      users = users.slice(0, limit);
    }

    const verificationMap = await getAccountVerificationMap(users.map((user) => user.username));
    users.forEach((user) => {
      const verification = verificationMap.get(normalizeOffboardIdentifier(user.username));
      user.lastVerifiedAt = verification?.lastVerifiedAt || null;
      user.lastVerifiedSource = verification?.lastVerifiedSource || 'none';
      user.originalRegistrationAt = verification?.originalRegistrationAt || null;
    });

    // Log viewing the user list
    await logAuditAction({
      action: AuditActions.VIEW_USER_LIST,
      category: AuditCategories.USER,
      username: admin.username,
      details: {
        query: query || null,
        includeVpnOnly,
        userCount: users.length,
        adCount: ldapUsers.length,
        vpnCount: vpnAccounts.length
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ users });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch users from Active Directory', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
