import { NextRequest, NextResponse } from 'next/server';

import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { prisma } from '@/lib/prisma';
import { actorHasPermission } from '@/lib/rbac/core';

export const dynamic = 'force-dynamic';

/** Exact catalog used by automatic group-membership workflow actions. */
export async function GET(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actorHasPermission(admin, 'automation.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const groups = await prisma.allowedTicketSubjectGroup.findMany({
    where: { isActive: true, canJoinViaTicket: true, autoApproveJoin: true },
    orderBy: { name: 'asc' },
    select: { dn: true, name: true },
  });
  return NextResponse.json({
    groups: groups.map((group) => ({
      dn: group.dn,
      label: group.name,
      policy: 'Active · Auto-approve',
    })),
  });
}
