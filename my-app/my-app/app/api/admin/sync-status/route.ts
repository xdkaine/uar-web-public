import { NextRequest } from 'next/server';
import { prisma } from '@/lib/prisma';
import { secureJsonResponse, secureErrorResponse } from '@/lib/apiResponse';
import { getSessionFromRequest } from '@/lib/session';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { listUsersInOU } from '@/lib/ldap';
import { extractBronconame } from '@/lib/validation';
import { appLogger } from '@/lib/logger';

interface SyncStatusAccount {
  identifier: string;
  name: string;
  email: string | null;
  hasAdAccount: boolean;
  adUsername: string | null;
  adDisplayName: string | null;
  adEmail: string | null;
  adSyncDate: string | null;
  hasVpnAccount: boolean;
  vpnUsername: string | null;
  vpnPortalType: string | null;
  vpnStatus: string | null;
  vpnCreatedAt: string | null;
  hasAccessRequest: boolean;
  requestId: string | null;
  requestStatus: string | null;
  requestCreatedAt: string | null;
  isManuallyAssigned: boolean;
  syncStatus: 'fully_synced' | 'partial_sync' | 'ad_only' | 'vpn_only' | 'request_only' | 'orphaned';
  syncIssues: string[];
  lastSyncId: string | null;
  wasAutoAssigned: boolean;
}

export async function GET(req: NextRequest) {
  try {
    // Verify admin session
    const { admin, response } = await checkAdminAuthWithRateLimit(req);
    if (!admin || response) {
      return response || secureErrorResponse('Unauthorized', 401);
    }
    const session = { username: admin.username };

    appLogger.info('Fetching account sync status', { admin: session.username });

    // Fetch all data sources in parallel
    const [adUsers, vpnAccounts, accessRequests, latestSync] = await Promise.all([
      // Get ALL AD users
      listUsersInOU().catch(err => {
        appLogger.error('Failed to fetch AD users', err);
        return [];
      }),

      // Get VPN accounts
      prisma.vPNAccount.findMany({
        where: {
          status: {
            in: ['active', 'pending_faculty', 'disabled', 'revoked'],
          },
        },
        select: {
          id: true,
          username: true,
          name: true,
          email: true,
          portalType: true,
          status: true,
          createdAt: true,
          accessRequestId: true,
          adUsername: true,
        },
      }),

      // Get access requests (both internal and external)
      prisma.accessRequest.findMany({
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          createdAt: true,
          ldapUsername: true,
          vpnUsername: true,
          isManuallyAssigned: true,
          linkedAdUsername: true,
          linkedVpnUsername: true,
          isInternal: true,
        },
      }),

      // Get latest sync
      prisma.aDAccountSync.findFirst({
        orderBy: { createdAt: 'desc' },
        include: {
          matches: true,
        },
      }),
    ]);

    // Create a map to track all unique accounts
    const accountMap = new Map<string, SyncStatusAccount>();

    // Helper to get or create account entry
    const getOrCreateAccount = (identifier: string, email: string | null, name: string): SyncStatusAccount => {
      const key = identifier.toLowerCase();
      if (!accountMap.has(key)) {
        accountMap.set(key, {
          identifier,
          name,
          email,
          hasAdAccount: false,
          adUsername: null,
          adDisplayName: null,
          adEmail: null,
          adSyncDate: null,
          hasVpnAccount: false,
          vpnUsername: null,
          vpnPortalType: null,
          vpnStatus: null,
          vpnCreatedAt: null,
          hasAccessRequest: false,
          requestId: null,
          requestStatus: null,
          requestCreatedAt: null,
          isManuallyAssigned: false,
          syncStatus: 'orphaned',
          syncIssues: [],
          lastSyncId: null,
          wasAutoAssigned: false,
        });
      }
      return accountMap.get(key)!;
    };

    // Process AD users
    for (const adUser of adUsers) {
      // Use username from AD directly, or extract from email if available
      const identifier = adUser.username ||
        (adUser.email ? extractBronconame(adUser.email) : null);

      if (!identifier) {
        appLogger.warn('Could not determine identifier for AD user', {
          displayName: adUser.displayName,
          email: adUser.email
        });
        continue;
      }

      const account = getOrCreateAccount(
        identifier,
        adUser.email || `None`,
        adUser.displayName
      );
      account.hasAdAccount = true;
      account.adUsername = identifier;
      account.adDisplayName = adUser.displayName;
      account.adEmail = adUser.email || null;

      // Find matching sync record
      const syncMatch = latestSync?.matches.find(
        (m: { adUsername: string }) => m.adUsername.toLowerCase() === identifier.toLowerCase()
      );
      if (syncMatch) {
        account.adSyncDate = syncMatch.createdAt.toISOString();
        account.lastSyncId = syncMatch.syncId;
        account.wasAutoAssigned = syncMatch.wasAutoAssigned;
      }
    }

    // Process VPN accounts
    for (const vpnAccount of vpnAccounts) {
      // VPN accounts can be linked to AD accounts via adUsername field
      // Use adUsername as primary identifier if available, otherwise use VPN username
      const identifier = vpnAccount.adUsername || vpnAccount.username;
      const account = getOrCreateAccount(
        identifier,
        vpnAccount.email,
        vpnAccount.name
      );
      account.hasVpnAccount = true;
      account.vpnUsername = vpnAccount.username;
      account.vpnPortalType = vpnAccount.portalType;
      account.vpnStatus = vpnAccount.status;
      account.vpnCreatedAt = vpnAccount.createdAt.toISOString();

      // If VPN username differs from AD username, note this for reference
      if (vpnAccount.adUsername && vpnAccount.adUsername !== vpnAccount.username) {
        // VPN account is linked to a different AD username
        // Make sure the AD account also knows about this VPN account
        const adIdentifier = vpnAccount.adUsername.toLowerCase();
        const existingAdAccount = accountMap.get(adIdentifier);
        if (existingAdAccount && !existingAdAccount.hasVpnAccount) {
          existingAdAccount.hasVpnAccount = true;
          existingAdAccount.vpnUsername = vpnAccount.username;
          existingAdAccount.vpnPortalType = vpnAccount.portalType;
          existingAdAccount.vpnStatus = vpnAccount.status;
          existingAdAccount.vpnCreatedAt = vpnAccount.createdAt.toISOString();
        }
      }
    }

    // Process access requests
    for (const request of accessRequests) {
      // Try to match by linked username, LDAP username, email, or VPN username
      const identifier = request.linkedAdUsername ||
        request.ldapUsername ||
        extractBronconame(request.email) ||
        request.vpnUsername ||
        request.email;

      const account = getOrCreateAccount(identifier, request.email, request.name);
      account.hasAccessRequest = true;
      account.requestId = request.id;
      account.requestStatus = request.status;
      account.requestCreatedAt = request.createdAt.toISOString();
      account.isManuallyAssigned = request.isManuallyAssigned;

      // Also link to VPN username if different from primary identifier
      if (request.vpnUsername && request.vpnUsername !== identifier) {
        const vpnIdentifier = request.vpnUsername.toLowerCase();
        const existingVpnAccount = accountMap.get(vpnIdentifier);
        if (existingVpnAccount && !existingVpnAccount.hasAccessRequest) {
          existingVpnAccount.hasAccessRequest = true;
          existingVpnAccount.requestId = request.id;
          existingVpnAccount.requestStatus = request.status;
          existingVpnAccount.requestCreatedAt = request.createdAt.toISOString();
          existingVpnAccount.isManuallyAssigned = request.isManuallyAssigned;
        }
      }
    }

    // Determine sync status and issues for each account
    for (const account of accountMap.values()) {
      const sources = [
        account.hasAdAccount,
        account.hasVpnAccount,
        account.hasAccessRequest,
      ];
      const sourceCount = sources.filter(Boolean).length;

      // Determine sync status
      if (sourceCount === 3) {
        account.syncStatus = 'fully_synced';
      } else if (sourceCount === 2) {
        account.syncStatus = 'partial_sync';
      } else if (account.hasAdAccount && sourceCount === 1) {
        account.syncStatus = 'ad_only';
      } else if (account.hasVpnAccount && sourceCount === 1) {
        account.syncStatus = 'vpn_only';
      } else if (account.hasAccessRequest && sourceCount === 1) {
        account.syncStatus = 'request_only';
      } else {
        account.syncStatus = 'orphaned';
      }

      // Identify sync issues
      const issues: string[] = [];

      // Internal users should have all three
      if (account.hasAccessRequest && !['rejected', 'offboarded'].includes(account.requestStatus || '')) {
        if (!account.hasAdAccount) {
          issues.push('Access request exists but no AD account found');
        }
        if (!account.hasVpnAccount) {
          issues.push('Access request exists but no VPN account found');
        }
      }

      // AD users with @cpp.edu should have VPN and request
      if (account.hasAdAccount && account.adEmail?.endsWith('@cpp.edu')) {
        if (!account.hasVpnAccount) {
          issues.push('AD account exists but no VPN account found');
        }
        if (!account.hasAccessRequest) {
          issues.push('AD account exists but no access request found');
        }
      }

      // VPN Limited portal users should have AD account
      if (account.hasVpnAccount && account.vpnPortalType === 'Limited') {
        if (!account.hasAdAccount) {
          issues.push('VPN Limited account exists but no AD account found');
        }
      }

      // Check for username mismatches (only flag if they seem unintentional)
      // Username differences are OK if they're intentionally linked (e.g., tphao linked to tommy)
      if (account.hasAdAccount && account.hasVpnAccount) {
        const adLower = account.adUsername?.toLowerCase() || '';
        const vpnLower = account.vpnUsername?.toLowerCase() || '';

        // Only flag as an issue if usernames are completely different AND 
        // neither is a substring of the other (which might indicate intentional linking)
        if (adLower !== vpnLower &&
          !adLower.includes(vpnLower) &&
          !vpnLower.includes(adLower)) {
          issues.push(`Different usernames: AD="${account.adUsername}", VPN="${account.vpnUsername}"`);
        }
      }

      // Check for status inconsistencies
      if (account.hasAccessRequest && account.requestStatus === 'approved') {
        if (account.hasVpnAccount && account.vpnStatus !== 'active') {
          issues.push(`Approved request but VPN status is ${account.vpnStatus}`);
        }
        if (account.hasAdAccount && !account.hasVpnAccount) {
          // This is a real issue - approved request with AD but no VPN
          if (!issues.some(i => i.includes('VPN account'))) {
            issues.push('Approved request has AD account but missing VPN access');
          }
        }
      }

      account.syncIssues = issues;
    }

    // Convert to array and sort
    const accounts = Array.from(accountMap.values()).sort((a, b) =>
      a.identifier.localeCompare(b.identifier)
    );

    // Prepare latest sync info
    const latestSyncInfo = latestSync ? {
      id: latestSync.id,
      createdAt: latestSync.createdAt.toISOString(),
      completedAt: latestSync.completedAt?.toISOString() || null,
      status: latestSync.status,
      totalADAccounts: latestSync.totalADAccounts,
      totalVPNAccounts: latestSync.totalVPNAccounts,
      matchedAccounts: latestSync.matchedAccounts,
      unmatchedAD: latestSync.unmatchedAD,
      unmatchedVPN: latestSync.unmatchedVPN,
      autoAssigned: latestSync.autoAssigned,
    } : null;

    appLogger.info('Account sync status fetched successfully', {
      admin: session.username,
      totalAccounts: accounts.length,
      fullySynced: accounts.filter(a => a.syncStatus === 'fully_synced').length,
      withIssues: accounts.filter(a => a.syncIssues.length > 0).length,
    });

    return secureJsonResponse({
      accounts,
      latestSync: latestSyncInfo,
      stats: {
        total: accounts.length,
        fullySynced: accounts.filter(a => a.syncStatus === 'fully_synced').length,
        partialSync: accounts.filter(a => a.syncStatus === 'partial_sync').length,
        adOnly: accounts.filter(a => a.syncStatus === 'ad_only').length,
        vpnOnly: accounts.filter(a => a.syncStatus === 'vpn_only').length,
        requestOnly: accounts.filter(a => a.syncStatus === 'request_only').length,
        orphaned: accounts.filter(a => a.syncStatus === 'orphaned').length,
        withIssues: accounts.filter(a => a.syncIssues.length > 0).length,
        hasAd: accounts.filter(a => a.hasAdAccount).length,
        hasVpn: accounts.filter(a => a.hasVpnAccount).length,
        hasRequest: accounts.filter(a => a.hasAccessRequest).length,
        autoAssigned: accounts.filter(a => a.wasAutoAssigned).length,
      },
    });
  } catch (error) {
    appLogger.error('Failed to fetch account sync status', error);
    return secureErrorResponse(
      'Failed to fetch account sync status',
      500
    );
  }
}
