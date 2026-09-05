import { NextRequest, NextResponse } from 'next/server';

import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { isProductionCloneReadOnly } from '@/lib/clone-safety';
import { listUsersInOU } from '@/lib/ldap';
import { buildLifecycleAccountInventory } from '@/lib/lifecycle-account-inventory';
import { summarizeAccountOwnership } from '@/lib/account-ownership';
import { loadAccountOwnershipRecords } from '@/lib/account-ownership-records';
import { isModuleEnabled } from '@/lib/modules/core';
import { prisma } from '@/lib/prisma';
import { actorHasPermission } from '@/lib/rbac/core';

export async function GET(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actorHasPermission(admin, 'lifecycle.read')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const [directoryUsers, vpnAccounts, ownershipRecords, vpnModuleEnabled] = await Promise.all([
      listUsersInOU(),
      prisma.vPNAccount.findMany({
        orderBy: [{ username: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          username: true,
          adUsername: true,
          name: true,
          email: true,
          status: true,
          portalType: true,
          canRestore: true,
          accessRequestId: true,
          batchAccountItemId: true,
          batchId: true,
        },
      }),
      loadAccountOwnershipRecords(),
      isModuleEnabled('vpn.management'),
    ]);
    const linkAccess = { requests: actorHasPermission(admin, 'access_requests.read'), batches: actorHasPermission(admin, 'batch.manage') };
    const accounts = buildLifecycleAccountInventory({ directoryUsers, vpnAccounts, ...ownershipRecords })
      .map((account) => ({ ...account, ownership: summarizeAccountOwnership(account, linkAccess) }));
    return NextResponse.json({
      accounts,
      readOnly: isProductionCloneReadOnly(),
      vpnModuleEnabled,
      summary: {
        total: accounts.length,
        directory: accounts.filter((account) => account.directory).length,
        vpn: accounts.filter((account) => account.vpn).length,
      },
    });
  } catch (error) {
    console.error('Unable to build lifecycle account inventory:', error);
    return NextResponse.json({
      error: 'Unable to build the lifecycle account inventory.',
    }, { status: 500 });
  }
}
