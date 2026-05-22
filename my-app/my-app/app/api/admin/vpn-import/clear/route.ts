import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

/**
 * DELETE /api/admin/vpn-import/clear
 * Clears all VPN import records from the queue
 */
export async function DELETE(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Count records before deletion for logging
    const importCount = await prisma.vPNImport.count();
    const recordCount = await prisma.vPNImportRecord.count();

    // Delete all import records (cascade will handle VPNImportRecord)
    await prisma.vPNImport.deleteMany({});

    // Log audit action
    await logAuditAction({
      action: AuditActions.CLEAR_VPN_IMPORT_QUEUE,
      category: AuditCategories.VPN,
      username: admin.username,
      targetType: 'VPNImport',
      details: {
        importsDeleted: importCount,
        recordsDeleted: recordCount,
        action: 'clear_queue',
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({
      success: true,
      data: {
        message: `Cleared ${importCount} import(s) and ${recordCount} record(s) from queue`,
        importsDeleted: importCount,
        recordsDeleted: recordCount,
      },
    });
  } catch (error) {
    console.error('Error clearing VPN import queue:', error);
    return NextResponse.json(
      { error: 'Failed to clear VPN import queue' },
      { status: 500 }
    );
  }
}
