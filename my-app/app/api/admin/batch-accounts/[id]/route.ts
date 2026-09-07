import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { inspectBatchAccountSummary, projectBatchAccountDetail } from '@/lib/batch-account-detail';

// GET - Get batch details with full audit trail
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!actorHasPermission(admin, 'batch.manage')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const resolvedParams = await params;

    const batch = await prisma.batchAccountCreation.findUnique({
      where: { id: resolvedParams.id },
      select: {
        id: true,
        createdAt: true,
        updatedAt: true,
        createdBy: true,
        description: true,
        totalAccounts: true,
        successfulAccounts: true,
        failedAccounts: true,
        status: true,
        completedAt: true,
        accounts: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            createdAt: true,
            updatedAt: true,
            accountType: true,
            name: true,
            email: true,
            ldapUsername: true,
            vpnUsername: true,
            batchId: true,
            accessRequestId: true,
            lifecycleOwnerKind: true,
            accountExpiresAt: true,
            isInternal: true,
            status: true,
            mutationStage: true,
            ldapCreatedAt: true,
            vpnCreatedAt: true,
            errorMessage: true,
            completedAt: true,
            targetDirectoryDn: true,
            targetDirectoryObjectGuid: true,
          },
        },
        auditLogs: {
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            createdAt: true,
            action: true,
            details: true,
            performedBy: true,
            accountName: true,
            success: true,
          },
        },
        linkedTicket: {
          select: {
            id: true,
            subject: true,
            status: true,
            category: true,
            severity: true,
          },
        },
      },
    });

    if (!batch) {
      return NextResponse.json({ error: 'Batch not found' }, { status: 404 });
    }

    const accounts = batch.accounts.map(account => projectBatchAccountDetail(account, {
      batchId: batch.id,
      batchStatus: batch.status,
    }));
    const batchView = {
      id: batch.id,
      createdAt: batch.createdAt,
      updatedAt: batch.updatedAt,
      createdBy: batch.createdBy,
      canExport: batch.createdBy.trim().toLowerCase() === admin.username.trim().toLowerCase()
        && ['completed', 'failed'].includes(batch.status),
      description: batch.description,
      totalAccounts: batch.totalAccounts,
      successfulAccounts: batch.successfulAccounts,
      failedAccounts: batch.failedAccounts,
      status: batch.status,
      completedAt: batch.completedAt,
      linkedTicket: batch.linkedTicket,
      accounts,
      auditLogs: batch.auditLogs,
      integrityIssues: inspectBatchAccountSummary(batch, accounts),
    };

    // Log viewing batch details
    await logAuditAction({
      action: AuditActions.VIEW_BATCH_DETAILS,
      category: AuditCategories.BATCH,
      username: admin.username,
      targetId: resolvedParams.id,
      targetType: 'BatchAccountCreation',
      details: {
        description: batch.description,
        status: batch.status,
        totalAccounts: batch.totalAccounts,
        successfulAccounts: batch.successfulAccounts,
        failedAccounts: batch.failedAccounts,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json({ batch: batchView });
  } catch (error) {
    console.error('Error fetching batch details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch batch details' },
      { status: 500 }
    );
  }
}
