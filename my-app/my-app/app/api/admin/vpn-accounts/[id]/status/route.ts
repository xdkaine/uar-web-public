import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';

import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

function sanitizeAccount<T extends { password?: string | null }>(
  account: T
): Omit<T, 'password'> {
  const { password: _password, ...rest } = account;
  return rest;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { status, reason, changedBy } = body;

    if (!status) {
      return NextResponse.json(
        { error: 'Status is required' },
        { status: 400 }
      );
    }

    const validStatuses = ['active', 'pending_faculty', 'disabled'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: 'Invalid status' },
        { status: 400 }
      );
    }

    const resolvedParams = await params;
    const account = await prisma.vPNAccount.findUnique({
      where: { id: resolvedParams.id },
    });

    if (!account) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      );
    }

    const oldStatus = account.status;

    // Prepare update data
    const updateData: Record<string, unknown> = { status };

    // Handle status-specific updates
    if (status === 'disabled') {
      updateData.disabledAt = new Date();
      updateData.disabledBy = changedBy || 'System';
      updateData.disabledReason = reason;
    } else if (status === 'active' && oldStatus === 'pending_faculty') {
      updateData.createdByFaculty = true;
      updateData.facultyCreatedAt = new Date();
    }

    // Update the account
    const updated = await prisma.vPNAccount.update({
      where: { id: resolvedParams.id },
      data: updateData,
    });

    // Log the status change
    await prisma.vPNAccountStatusLog.create({
      data: {
        accountId: account.id,
        oldStatus,
        newStatus: status,
        changedBy: changedBy || 'System',
        reason: reason || `Status changed from ${oldStatus} to ${status}`,
      },
    });

    // Log audit action for VPN account status change
    const action = status === 'disabled' 
      ? AuditActions.DISABLE_VPN_ACCOUNT 
      : status === 'active'
      ? AuditActions.ENABLE_VPN_ACCOUNT
      : AuditActions.UPDATE_VPN_ACCOUNT;

    await logAuditAction({
      action,
      category: AuditCategories.VPN,
      username: admin.username,
      targetId: resolvedParams.id,
      targetType: 'VPNAccount',
      details: {
        username: account.username,
        oldStatus,
        newStatus: status,
        reason,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json(sanitizeAccount(updated));
  } catch (error) {
    console.error('Error updating VPN account status:', error);
    return NextResponse.json(
      { error: 'Failed to update VPN account status' },
      { status: 500 }
    );
  }
}
