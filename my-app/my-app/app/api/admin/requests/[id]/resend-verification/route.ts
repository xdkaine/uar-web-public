import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { sendVerificationEmail } from '@/lib/email';
import { appLogger } from '@/lib/logger';
import {
  AuditActions,
  AuditCategories,
  getIpAddress,
  getUserAgent,
  logAuditAction,
} from '@/lib/audit-log';

/**
 * Admin endpoint to resend a verification email for an access request
 * POST /api/admin/requests/[id]/resend-verification
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

    const { id: requestId } = await params;

    const accessRequest = await prisma.accessRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        name: true,
        email: true,
        isVerified: true,
        status: true,
        verificationToken: true,
        verificationAttempts: true,
        verificationTokenExpiresAt: true,
      },
    });

    if (!accessRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    if (accessRequest.isVerified || accessRequest.status !== 'pending_verification') {
      return NextResponse.json(
        { error: 'Verification email can only be resent for pending verifications' },
        { status: 400 }
      );
    }

    const previousToken = accessRequest.verificationToken;
    const previousAttempts = accessRequest.verificationAttempts ?? 0;
    const previousExpiresAt = accessRequest.verificationTokenExpiresAt;
    const newToken = nanoid(32);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

    await prisma.accessRequest.update({
      where: { id: requestId },
      data: {
        verificationToken: newToken,
        verificationAttempts: 0,
        verificationTokenExpiresAt: expiresAt,
      },
    });

    try {
      await sendVerificationEmail(accessRequest.email, accessRequest.name, newToken);
    } catch (error) {
      // Revert token update so existing links remain valid if email send fails
      await prisma.accessRequest.update({
        where: { id: requestId },
        data: {
          verificationToken: previousToken,
          verificationAttempts: previousAttempts,
          verificationTokenExpiresAt: previousExpiresAt,
        },
      }).catch((revertError: unknown) => {
        appLogger.error('Failed to revert verification token after email failure', {
          requestId,
          revertError: revertError instanceof Error ? revertError.message : 'Unknown error',
        });
      });

      appLogger.error('Failed to resend verification email', {
        requestId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });

      return NextResponse.json(
        { error: 'Failed to send verification email' },
        { status: 500 }
      );
    }

    await logAuditAction({
      action: AuditActions.RESEND_VERIFICATION_EMAIL,
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      targetId: requestId,
      targetType: 'access_request',
      details: {
        email: accessRequest.email,
        name: accessRequest.name,
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    appLogger.info('Verification email resent for access request', {
      requestId,
      adminUser: admin.username,
    });

    return NextResponse.json({
      success: true,
      message: 'Verification email sent successfully',
    });
  } catch (error) {
    appLogger.error('Unexpected error during verification resend', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return NextResponse.json(
      { error: 'Failed to resend verification email' },
      { status: 500 }
    );
  }
}
