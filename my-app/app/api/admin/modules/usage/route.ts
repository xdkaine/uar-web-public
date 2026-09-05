import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { getModuleUsage } from '@/lib/modules/usage';

export const dynamic = 'force-dynamic';

/**
 * Live usage evidence for the Modules configuration panel: which admin tabs,
 * workflow graphs, automation rules, and cron jobs each capability module
 * powers. Write-gated like other config reads because the payload includes
 * operational detail beyond the open module-state list.
 */
export async function GET(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'modules.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const modules = await getModuleUsage();
  return NextResponse.json({ modules });
}
