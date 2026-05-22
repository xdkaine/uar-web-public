import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

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

    const resolvedParams = await params;

    const batch = await prisma.batchAccountCreation.findUnique({
      where: { id: resolvedParams.id },
      include: {
        accounts: {
          orderBy: { createdAt: 'asc' },
        },
        auditLogs: {
          orderBy: { createdAt: 'asc' },
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

    const sanitizedBatch = {
      ...batch,
      accounts: batch.accounts.map(({ password: _password, ...account }: { password: string; [key: string]: unknown }) => account),
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

    return NextResponse.json({ batch: sanitizedBatch });
  } catch (error) {
    console.error('Error fetching batch details:', error);
    return NextResponse.json(
      { error: 'Failed to fetch batch details' },
      { status: 500 }
    );
  }
}
