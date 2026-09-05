import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { listUsersInOU } from '@/lib/ldap';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { prisma } from '@/lib/prisma';
import { loadAccountOwnershipRecords } from '@/lib/account-ownership-records';
import { summarizeAccountOwnership, unavailableAccountOwnership, type AccountOwnershipSummary } from '@/lib/account-ownership';
import { buildLifecycleAccountInventory } from '@/lib/lifecycle-account-inventory';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { getAccountVerificationMap, normalizeOffboardIdentifier } from '@/lib/offboard-campaign';
import {
  classifyDirectoryQueryError,
  DIRECTORY_RESULT_CAP,
  type DirectoryFetchState,
} from './directory-fetch-state';

type LdapDirectoryUser = Awaited<ReturnType<typeof listUsersInOU>>[number];

interface VpnDetails {
  status: string;
  portalType: string;
}

interface AdminUserListItem extends LdapDirectoryUser {
  ownership?: AccountOwnershipSummary;
  vpnDetails: VpnDetails | null;
  lastVerifiedAt?: Date | null;
  lastVerifiedSource?: string;
  originalRegistrationAt?: Date | null;
}

async function logDirectoryFetchFailure(
  request: NextRequest,
  username: string,
  state: Extract<DirectoryFetchState, { state: 'size_limit_error' | 'query_error' }>['state'],
  includeVpnOnly: boolean,
): Promise<string | undefined> {
  const correlationId = randomUUID();

  try {
    await logAuditAction({
      action: AuditActions.VIEW_USER_LIST,
      category: AuditCategories.USER,
      username,
      eventKind: 'read',
      outcome: 'failure',
      success: false,
      correlationId,
      details: {
        directoryFetchState: state,
        includeVpnOnly,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });
    return correlationId;
  } catch {
    // A diagnostic reference is useful only when its audit record exists.
    return undefined;
  }
}

export async function GET(request: NextRequest) {
  let auditUsername: string | null = null;

  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!actorHasPermission(admin, 'users.read')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    auditUsername = admin.username;

    const searchParams = request.nextUrl.searchParams;
    const query = (searchParams.get('q') || '').trim().toLowerCase();
    const requestedLimit = Number(searchParams.get('limit') || 0);
    const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? Math.min(requestedLimit, 100) : null;
    const includeVpnOnly = searchParams.get('includeVpnOnly') !== 'false';

    let ldapUsers: Awaited<ReturnType<typeof listUsersInOU>>;
    try {
      ldapUsers = await listUsersInOU();
    } catch (error) {
      const state = classifyDirectoryQueryError(error);
      const diagnosticReference = await logDirectoryFetchFailure(
        request,
        admin.username,
        state,
        includeVpnOnly,
      );
      return NextResponse.json(
        {
          error: state === 'size_limit_error'
            ? 'The Active Directory query exceeded its result limit.'
            : 'The Active Directory query could not be completed.',
          directory: {
            state,
            ...(diagnosticReference ? { diagnosticReference } : {}),
          },
        },
        { status: 503 }
      );
    }

    const vpnAccounts = await prisma.vPNAccount.findMany({
      select: {
        id: true,
        name: true,
        adUsername: true,
        accessRequestId: true,
        batchAccountItemId: true,
        batchId: true,
        username: true,
        status: true,
        portalType: true,
        email: true,
      }
    });

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

    const ownershipRecords = await loadAccountOwnershipRecords();
    const inventory = buildLifecycleAccountInventory({ directoryUsers: ldapUsers, vpnAccounts, ...ownershipRecords });
    const linkAccess = { requests: actorHasPermission(admin, 'access_requests.read'), batches: actorHasPermission(admin, 'batch.manage') };
    const ownershipByRef = new Map(inventory.map((account) => [account.accountRef, summarizeAccountOwnership(account, linkAccess)]));
    let users = Array.from(userMap.values()).map((user) => ({
      ...user,
      ownership: ownershipByRef.get(`${user.dn ? 'ad' : 'vpn'}:${user.username.trim().toLowerCase()}`) ?? unavailableAccountOwnership(),
    }));
    if (query) {
      users = users.filter((user) => (
        [user.username, user.displayName || '', user.email || '', user.description || '', user.ownership.requestId || '', user.ownership.batchRunId || '', user.ownership.batchItemId || '']
          .some((value) => value.toLowerCase().includes(query))
      ));
    }
    if (limit) {
      users = users.slice(0, limit);
    }

    const canReadUsers = actorHasPermission(admin, 'users.read');
    if (canReadUsers) {
      const verificationMap = await getAccountVerificationMap(users.map((user) => user.username));
      users.forEach((user) => {
        const verification = verificationMap.get(normalizeOffboardIdentifier(user.username));
        user.lastVerifiedAt = verification?.lastVerifiedAt || null;
        user.lastVerifiedSource = verification?.lastVerifiedSource || 'none';
        user.originalRegistrationAt = verification?.originalRegistrationAt || null;
      });
    }

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

    const directory: DirectoryFetchState = ldapUsers.length >= DIRECTORY_RESULT_CAP
      ? { state: 'result_cap_reached', resultCap: DIRECTORY_RESULT_CAP }
      : { state: 'success' };

    return NextResponse.json({
      users: canReadUsers ? users : users.map((user) => ({
        username: user.username,
        displayName: user.displayName,
        email: user.email,
        accountEnabled: user.accountEnabled,
        dn: user.dn,
        vpnDetails: user.vpnDetails,
      })),
      directory,
    });
  } catch {
    const diagnosticReference = randomUUID();
    if (auditUsername) {
      try {
        await logAuditAction({
          action: AuditActions.VIEW_USER_LIST,
          category: AuditCategories.USER,
          username: auditUsername,
          eventKind: 'read',
          outcome: 'failure',
          success: false,
          correlationId: diagnosticReference,
          details: { dataSource: 'user_directory_aggregation' },
          ipAddress: getIpAddress(request),
          userAgent: getUserAgent(request),
        });
      } catch {
        // Do not expose a reference for an audit record that was not written.
      }
    }

    return NextResponse.json(
      {
        error: 'The user directory data could not be assembled.',
      },
      { status: 500 }
    );
  }
}
