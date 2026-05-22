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
    const account = await prisma.vPNAccount.findUnique({
      where: { id: resolvedParams.id },
      include: {
        statusLogs: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!account) {
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 404 }
      );
    }

    // Log viewing VPN account details
    await logAuditAction({
      action: AuditActions.VIEW_VPN_ACCOUNT,
      category: AuditCategories.VPN,
      username: admin.username,
      targetId: resolvedParams.id,
      targetType: 'VPNAccount',
      details: {
        username: account.username,
        name: account.name,
        portalType: account.portalType,
        status: account.status,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json(sanitizeAccount(account));
  } catch (error) {
    console.error('Error fetching VPN account:', error);
    return NextResponse.json(
      { error: 'Failed to fetch VPN account' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return (
        response ||
        NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      );
    }

    const body = await request.json();
    const { name, email, notes, expiresAt } = body;

    const resolvedParams = await params;
    const account = await prisma.vPNAccount.update({
      where: { id: resolvedParams.id },
      data: {
        name,
        email,
        notes,
        expiresAt: expiresAt ? new Date(expiresAt) : undefined,
      },
    });

    // Log audit action
    await logAuditAction({
      action: AuditActions.UPDATE_VPN_ACCOUNT,
      category: AuditCategories.VPN,
      username: admin.username,
      targetId: resolvedParams.id,
      targetType: 'VPNAccount',
      details: {
        vpnUsername: account.username,
        changes: { name, email, notes, expiresAt },
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json(sanitizeAccount(account));
  } catch (error) {
    console.error('Error updating VPN account:', error);
    
    // Log failed update attempt
    const { admin: adminRetry } = await checkAdminAuthWithRateLimit(request);
    const resolvedParams = await params;
    if (adminRetry) {
      await logAuditAction({
        action: AuditActions.UPDATE_VPN_ACCOUNT,
        category: AuditCategories.VPN,
        username: adminRetry.username,
        targetId: resolvedParams.id,
        targetType: 'VPNAccount',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }
    
    return NextResponse.json(
      { error: 'Failed to update VPN account' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return (
        response ||
        NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      );
    }

    const { searchParams } = new URL(request.url);
    const changedBy = searchParams.get('changedBy') || 'System';
    const reason = searchParams.get('reason') || 'Account deleted';

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

    // Log the status change before deletion
    await prisma.vPNAccountStatusLog.create({
      data: {
        accountId: account.id,
        oldStatus: account.status,
        newStatus: 'disabled',
        changedBy,
        reason,
      },
    });

    // Soft delete by setting status to disabled
    const updated = await prisma.vPNAccount.update({
      where: { id: resolvedParams.id },
      data: {
        status: 'disabled',
        disabledAt: new Date(),
        disabledBy: changedBy,
        disabledReason: reason,
      },
    });

    // Log audit action
    await logAuditAction({
      action: AuditActions.DELETE_VPN_ACCOUNT,
      category: AuditCategories.VPN,
      username: admin.username,
      targetId: resolvedParams.id,
      targetType: 'VPNAccount',
      details: {
        vpnUsername: account.username,
        changedBy,
        reason,
        softDelete: true,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json(sanitizeAccount(updated));
  } catch (error) {
    console.error('Error deleting VPN account:', error);
    
    // Log failed deletion attempt
    const { admin: adminRetry } = await checkAdminAuthWithRateLimit(request);
    const resolvedParams = await params;
    if (adminRetry) {
      await logAuditAction({
        action: AuditActions.DELETE_VPN_ACCOUNT,
        category: AuditCategories.VPN,
        username: adminRetry.username,
        targetId: resolvedParams.id,
        targetType: 'VPNAccount',
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });
    }
    
    return NextResponse.json(
      { error: 'Failed to delete VPN account' },
      { status: 500 }
    );
  }
}
