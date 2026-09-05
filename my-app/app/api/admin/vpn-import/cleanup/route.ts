import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { requireModuleEnabled } from '@/lib/modules/guards';

import { getIpAddress, logAuditAction } from '@/lib/audit-log';

/**
 * Cleanup expired VPN imports
 * DELETE /api/admin/vpn-import/cleanup
 */
export async function DELETE(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'vpn.manage')) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const vpnModuleGuard = await requireModuleEnabled('vpn.management');
    if (vpnModuleGuard) return vpnModuleGuard;
    const { searchParams } = new URL(request.url);
    const force = searchParams.get('force') === 'true';

    const whereClause: Prisma.VPNImportWhereInput = {
      expiresAt: {
        lt: new Date(),
      },
    };

    // If not forcing, only delete completed/failed imports
    if (!force) {
      whereClause.status = {
        in: ['completed', 'failed'],
      };
    }

    // Count what will be deleted
    const count = await prisma.vPNImport.count({
      where: whereClause,
    });

    if (count === 0) {
      return NextResponse.json({
        success: true,
        data: {
          deletedCount: 0,
          message: 'No expired imports to clean up',
        },
      });
    }

    // Delete the imports (cascade will handle records)
    const result = await prisma.vPNImport.deleteMany({
      where: whereClause,
    });

    // Log cleanup action
    await logAuditAction({
      category: 'vpn',
      action: 'import_cleanup',
      username: admin.username,
      targetType: 'VPNImport',
      targetId: 'bulk',
      details: {
        deletedCount: result.count,
        force,
      },
      ipAddress: getIpAddress(request) || 'unknown',
      success: true,
    });

    return NextResponse.json({
      success: true,
      data: {
        deletedCount: result.count,
        message: `Successfully cleaned up ${result.count} expired import(s)`,
      },
    });
  } catch (error) {
    console.error('Cleanup VPN imports error:', error);
    return NextResponse.json(
      { error: 'Failed to cleanup VPN imports' },
      { status: 500 }
    );
  }
}
