import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { 
  syncInfrastructureAccounts, 
  getLatestInfrastructureSync,
  getInfrastructureSyncHistory,
  getInfrastructureSyncById,
} from '@/lib/infrastructure-sync';
import { appLogger } from '@/lib/logger';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { isJsonBodyError, parseAdminJson } from '@/lib/admin-json-parser';

export const dynamic = 'force-dynamic';

type InfrastructureSyncBody = {
  dryRun?: boolean;
  action?: 'run_sync' | 'retry_tagging';
  syncId?: string;
  taskId?: string;
  confirmedDirectoryStateReviewed?: boolean;
};

/**
 * POST - Run infrastructure sync
 * GET - Get sync status and history
 */
export async function POST(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!actorHasPermission(admin, 'settings.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    const body = await parseAdminJson<InfrastructureSyncBody>(request);
    const { dryRun = false } = body;

    if (body.action === 'retry_tagging') {
      return NextResponse.json({
        error: 'Legacy directory metadata retries are retired. Reconcile portal ownership without an LDAP metadata write.',
        code: 'DIRECTORY_METADATA_RETRY_RETIRED',
      }, { status: 409 });
    }

    appLogger.info('Infrastructure sync triggered', { 
      triggeredBy: admin.username,
      dryRun 
    });

    const result = await syncInfrastructureAccounts({
      triggeredBy: admin.username,
      dryRun,
    });

    // Log audit action
    await logAuditAction({
      action: AuditActions.SYNC_INFRASTRUCTURE,
      category: AuditCategories.SETTINGS,
      username: admin.username,
      details: {
        dryRun,
        result,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    const partial = result.status !== 'completed';
    return NextResponse.json({
      success: result.status === 'completed',
      partial,
      message: dryRun
        ? partial ? 'Dry run completed with unresolved rows' : 'Dry run completed'
        : result.status === 'failed'
          ? 'Infrastructure sync failed; the durable sync record contains recovery details'
          : partial ? 'Infrastructure sync completed with errors requiring review' : 'Infrastructure sync completed',
      data: result,
    }, { status: partial ? 207 : 200 });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.statusCode });
    }

    appLogger.error('Infrastructure sync API error', error);
    
    // Log failed sync attempt
    const { admin: adminRetry } = await checkAdminAuthWithRateLimit(request);
    if (adminRetry) {
      await logAuditAction({
        action: AuditActions.SYNC_INFRASTRUCTURE,
        category: AuditCategories.SETTINGS,
        username: adminRetry.username,
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to run infrastructure sync',
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!actorHasPermission(admin, 'settings.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    
    const { searchParams } = new URL(request.url);
    const action = searchParams.get('action') || 'status';
    const syncId = searchParams.get('syncId');
    const limit = parseInt(searchParams.get('limit') || '10');

    // Log audit action for viewing sync results
    await logAuditAction({
      action: AuditActions.VIEW_SYNC_RESULTS,
      category: AuditCategories.SETTINGS,
      username: admin.username,
      details: {
        action,
        syncId: syncId || undefined,
        limit,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    if (action === 'history') {
      const history = await getInfrastructureSyncHistory(limit);
      return NextResponse.json({
        success: true,
        data: { history },
      });
    }

    if (action === 'details' && syncId) {
      const sync = await getInfrastructureSyncById(syncId);
      if (!sync) {
        return NextResponse.json(
          { success: false, error: 'Sync not found' },
          { status: 404 }
        );
      }
      return NextResponse.json({
        success: true,
        data: { sync },
      });
    }

    // Default: return latest sync status
    const latestSync = await getLatestInfrastructureSync();
    return NextResponse.json({
      success: true,
      data: latestSync,
    });
  } catch (error) {
    appLogger.error('Infrastructure sync status API error', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch sync status',
      },
      { status: 500 }
    );
  }
}
