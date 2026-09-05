import { NextRequest, NextResponse } from 'next/server';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { secureJsonResponse, secureErrorResponse } from '@/lib/apiResponse';
import { retryFailedAction } from '@/lib/lifecycle-processor';
import { logAuditAction, AuditCategories, AuditActions, getIpAddress } from '@/lib/audit-log';
import { prisma } from '@/lib/prisma';
import { actorCanOperateLifecycleAction } from '@/lib/lifecycle-authorization';
import { isProductionCloneReadOnly } from '@/lib/clone-safety';
import { expectedDirectoryDeletePolicyVersion, hasCurrentDirectoryDeleteMethod } from '@/lib/lifecycle-directory-deletion-policy';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!actorHasPermission(admin, 'lifecycle.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;

  try {
    if (isProductionCloneReadOnly()) {
      return secureErrorResponse('Lifecycle mutations are disabled in this production-clone environment.', 409);
    }
    const action = await prisma.accountLifecycleAction.findUnique({
      where: { id },
      select: { status: true, actionType: true, operationMode: true, policyVersion: true, authorizationEvidence: true },
    });
    if (!action) return secureErrorResponse('Lifecycle action not found', 404);
    if (!actorCanOperateLifecycleAction(admin, action)) {
      return secureErrorResponse('Your privileges do not allow retrying this lifecycle action.', 403);
    }
    if (action?.status === 'reconciliation_required') {
      return secureErrorResponse('This action has an uncertain external outcome and must be reconciled with evidence before any retry.', 409);
    }
    if (
      action.actionType === 'delete_ad'
      && (
        action.policyVersion !== expectedDirectoryDeletePolicyVersion(action.operationMode)
        || !hasCurrentDirectoryDeleteMethod(action.authorizationEvidence)
      )
    ) {
      return secureErrorResponse('This AD deletion was reviewed using an earlier deletion method. Refresh the account state and create a new deletion confirmation.', 409);
    }
    const success = await retryFailedAction(id);

    if (!success) {
      return secureErrorResponse('Failed to retry action');
    }

    // Log the retry action
    await logAuditAction({
      username: admin.username,
      action: AuditActions.RETRY_LIFECYCLE_ACTION,
      category: AuditCategories.LIFECYCLE,
      details: { actionId: id },
      ipAddress: getIpAddress(request) || 'unknown',
      userAgent: request.headers.get('user-agent') || 'unknown',
    });

    return secureJsonResponse({ message: 'Action queued for retry' }, 200);
  } catch (error) {
    console.error('Error retrying lifecycle action:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return secureErrorResponse(errorMessage);
  }
}
