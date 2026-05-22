import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { decryptPassword } from '@/lib/encryption';
import { logAuditAction, AuditActions, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';

/**
 * Secure Password Reveal Endpoint
 * 
 * This endpoint is specifically designed for revealing account passwords
 * with comprehensive audit logging. It should only be used when an admin
 * explicitly needs to view a password (e.g., to communicate to a user).
 * 
 * Security measures:
 * - Admin authentication with rate limiting
 * - Detailed audit logging of every password access
 * - Only reveals passwords for external (non-internal) accounts
 * - Returns error for internal accounts (passwords should never be revealed)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);

    if (!admin || response) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const resolvedParams = await params;
    const requestId = resolvedParams.id;

    // Fetch the access request
    const accessRequest = await prisma.accessRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        name: true,
        email: true,
        isInternal: true,
        status: true,
        accountPassword: true,
        ldapUsername: true,
      },
    });

    if (!accessRequest) {
      // Log attempt to access non-existent request
      await logAuditAction({
        action: AuditActions.VIEW_REQUEST,
        category: AuditCategories.ACCESS_REQUEST,
        username: admin.username,
        targetId: requestId,
        targetType: 'AccessRequest',
        details: {
          action: 'reveal_password_attempt',
          reason: 'request_not_found',
        },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
        success: false,
      });

      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    // Security: Never reveal passwords for internal accounts
    if (accessRequest.isInternal) {
      await logAuditAction({
        action: AuditActions.VIEW_REQUEST,
        category: AuditCategories.ACCESS_REQUEST,
        username: admin.username,
        targetId: requestId,
        targetType: 'AccessRequest',
        details: {
          action: 'reveal_password_blocked',
          reason: 'internal_account',
          requestName: accessRequest.name,
          requestEmail: accessRequest.email,
        },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
        success: false,
      });

      return NextResponse.json(
        { error: 'Password reveal is not available for internal accounts' },
        { status: 403 }
      );
    }

    // Check if password exists
    if (!accessRequest.accountPassword) {
      await logAuditAction({
        action: AuditActions.VIEW_REQUEST,
        category: AuditCategories.ACCESS_REQUEST,
        username: admin.username,
        targetId: requestId,
        targetType: 'AccessRequest',
        details: {
          action: 'reveal_password_attempt',
          reason: 'no_password_stored',
          requestName: accessRequest.name,
        },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
        success: false,
      });

      return NextResponse.json(
        { error: 'No password is stored for this request' },
        { status: 404 }
      );
    }

    // Attempt to decrypt the password
    let decryptedPassword: string;
    try {
      decryptedPassword = decryptPassword(accessRequest.accountPassword);
    } catch (decryptError) {
      console.error('[Password Reveal] Decryption failed for request:', requestId);

      await logAuditAction({
        action: AuditActions.VIEW_REQUEST,
        category: AuditCategories.ACCESS_REQUEST,
        username: admin.username,
        targetId: requestId,
        targetType: 'AccessRequest',
        details: {
          action: 'reveal_password_failed',
          reason: 'decryption_error',
          requestName: accessRequest.name,
        },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
        success: false,
      });

      return NextResponse.json(
        { error: 'Failed to decrypt password. Please contact system administrator.' },
        { status: 500 }
      );
    }

    // Log successful password reveal - this is a sensitive operation
    await logAuditAction({
      action: AuditActions.VIEW_REQUEST,
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      targetId: requestId,
      targetType: 'AccessRequest',
      details: {
        action: 'reveal_password_success',
        requestName: accessRequest.name,
        requestEmail: accessRequest.email,
        ldapUsername: accessRequest.ldapUsername,
        status: accessRequest.status,
        // Note: Never log the actual password
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
      success: true,
    });

    // Return the decrypted password
    // Note: This should be transmitted over HTTPS and displayed briefly to admin
    return NextResponse.json({
      password: decryptedPassword,
      warning: 'This password has been logged for audit purposes. Handle securely.',
    });

  } catch (error) {
    console.error('[Password Reveal] Unexpected error:', error);
    return NextResponse.json(
      { error: 'Failed to reveal password' },
      { status: 500 }
    );
  }
}
