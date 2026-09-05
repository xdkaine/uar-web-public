import { NextRequest } from 'next/server';
import { secureJsonResponse, secureErrorResponse } from '@/lib/apiResponse';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { listUsersInOU } from '@/lib/ldap';
import { prisma } from '@/lib/prisma';
import { isModuleEnabled } from '@/lib/modules/core';
import { loadAccountOwnershipRecords } from '@/lib/account-ownership-records';
import { projectSyncStatusAccounts } from '@/lib/sync-status-accounts';

export async function GET(req: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(req);
  if (!admin || response) return response || secureErrorResponse('Unauthorized', 401);
  if (!actorHasPermission(admin, 'sync.read')) return secureErrorResponse('Forbidden', 403);

  try {
    // A failed source must not masquerade as an empty directory or no owner.
    const [directoryUsers, vpnAccounts, ownershipRecords, latestSync, vpnModuleEnabled] = await Promise.all([
      listUsersInOU(),
      prisma.vPNAccount.findMany({
        where: { status: { in: ['active', 'pending_faculty', 'disabled', 'revoked'] } },
        select: {
          id: true, username: true, adUsername: true, name: true, email: true,
          portalType: true, status: true, createdAt: true, canRestore: true,
          accessRequestId: true, batchAccountItemId: true, batchId: true,
        },
      }),
      loadAccountOwnershipRecords(),
      prisma.aDAccountSync.findFirst({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, createdAt: true, completedAt: true, status: true,
          totalADAccounts: true, totalVPNAccounts: true, matchedAccounts: true,
          unmatchedAD: true, unmatchedVPN: true, autoAssigned: true,
          matches: { select: { adUsername: true, wasAutoAssigned: true, createdAt: true } },
        },
      }),
      isModuleEnabled('vpn.management'),
    ]);
    const matchesByUsername = new Map(latestSync?.matches.map((match) => [match.adUsername.trim().toLowerCase(), match]) ?? []);
    const accounts = projectSyncStatusAccounts({
      directoryUsers, vpnAccounts, ...ownershipRecords, vpnModuleEnabled,
      linkAccess: {
        requests: actorHasPermission(admin, 'access_requests.read'),
        batches: actorHasPermission(admin, 'batch.manage'),
      },
    }).map((account) => {
      const match = account.adUsername ? matchesByUsername.get(account.adUsername.trim().toLowerCase()) : undefined;
      return {
        ...account,
        adSyncDate: match?.createdAt.toISOString() ?? null,
        lastSyncId: match ? latestSync!.id : null,
        wasAutoAssigned: match?.wasAutoAssigned ?? false,
      };
    });
    const latestSyncInfo = latestSync ? {
      id: latestSync.id, createdAt: latestSync.createdAt.toISOString(),
      completedAt: latestSync.completedAt?.toISOString() ?? null,
      status: latestSync.status, totalADAccounts: latestSync.totalADAccounts,
      totalVPNAccounts: latestSync.totalVPNAccounts, matchedAccounts: latestSync.matchedAccounts,
      unmatchedAD: latestSync.unmatchedAD, unmatchedVPN: latestSync.unmatchedVPN,
      autoAssigned: latestSync.autoAssigned,
    } : null;
    return secureJsonResponse({ accounts, latestSync: latestSyncInfo });
  } catch {
    return secureErrorResponse(
      'Account sources could not be verified. Refresh Sync Status before using account ownership information.',
      503,
      { code: 'SYNC_SOURCES_UNAVAILABLE' },
    );
  }
}
