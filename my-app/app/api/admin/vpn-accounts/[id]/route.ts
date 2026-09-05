import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { requireModuleEnabled } from '@/lib/modules/guards';

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
    if (!actorHasPermission(admin, 'vpn.manage')) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
    if (!actorHasPermission(admin, 'vpn.manage')) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const vpnModuleGuard = await requireModuleEnabled('vpn.management');
    if (vpnModuleGuard) return vpnModuleGuard;
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
  _context: { params: Promise<{ id: string }> }
) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'vpn.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  return NextResponse.json({
    error: 'Direct VPN deletion is retired. Revoke the account first, then use Account Lifecycle permanent VPN record deletion.',
    code: 'USE_ACCOUNT_LIFECYCLE',
  }, { status: 405, headers: { Allow: 'GET, PATCH' } });
}
