import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { sendVerificationEmail } from '@/lib/email';
import { appLogger } from '@/lib/logger';
import {
  AuditActions,
  AuditCategories,
  getIpAddress,
  getUserAgent,
  logAuditAction,
} from '@/lib/audit-log';
import { hashAccessRequestVerificationToken } from '@/lib/access-request-verification';

const VERIFICATION_SEND_LEASE_MS = 5 * 60 * 1000;

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
    if (!actorHasPermission(admin, 'access_requests.provision')) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
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
        verificationTokenHash: true,
        verificationAttempts: true,
        verificationTokenExpiresAt: true,
        updatedAt: true,
      },
    });

    if (!accessRequest) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 });
    }

    if (accessRequest.isVerified) {
      return NextResponse.json(
        { error: 'Verification email can only be resent for pending verifications' },
        { status: 400 }
      );
    }

    if (accessRequest.status === 'verification_email_sending') {
      const staleBefore = new Date(Date.now() - VERIFICATION_SEND_LEASE_MS);
      if (accessRequest.updatedAt > staleBefore) {
        return NextResponse.json(
          { error: 'Verification resend is already in progress' },
          { status: 409 }
        );
      }

      const recovered = await prisma.accessRequest.updateMany({
        where: {
          id: requestId,
          isVerified: false,
          status: 'verification_email_sending',
          verificationToken: accessRequest.verificationToken,
          verificationTokenHash: accessRequest.verificationTokenHash,
          updatedAt: accessRequest.updatedAt,
        },
        data: {
          status: 'pending_verification',
          provisioningState: null,
          provisioningError: 'Previous verification delivery outcome was reconciled after its lease expired',
        },
      });

      if (recovered.count !== 1) {
        return NextResponse.json(
          { error: 'Verification resend is already in progress or the request changed' },
          { status: 409 }
        );
      }

      await logAuditAction({
        action: AuditActions.RESEND_VERIFICATION_EMAIL,
        category: AuditCategories.ACCESS_REQUEST,
        username: admin.username,
        targetId: requestId,
        targetType: 'access_request',
        success: false,
        details: { outcome: 'stale_delivery_state_reconciled' },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      });

      return NextResponse.json(
        {
          success: false,
          message: 'Previous delivery state reconciled. Retry if the recipient did not receive the email.',
        },
        { status: 202 }
      );
    }

    if (!['pending_verification', 'verification_email_failed'].includes(accessRequest.status)) {
      return NextResponse.json(
        { error: 'Verification email can only be resent for pending verifications' },
        { status: 400 }
      );
    }

    const newToken = nanoid(32);
    const newTokenHash = hashAccessRequestVerificationToken(newToken);
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours from now

    const claim = await prisma.accessRequest.updateMany({
      where: {
        id: requestId,
        isVerified: false,
        status: { in: ['pending_verification', 'verification_email_failed'] },
        verificationToken: accessRequest.verificationToken,
        verificationTokenHash: accessRequest.verificationTokenHash,
      },
      data: {
        verificationToken: null,
        verificationTokenHash: newTokenHash,
        verificationAttempts: 0,
        verificationTokenExpiresAt: expiresAt,
        status: 'verification_email_sending',
        provisioningState: 'verification_email_sending',
        provisioningError: null,
      },
    });

    if (claim.count !== 1) {
      return NextResponse.json(
        { error: 'Verification resend is already in progress or the request changed' },
        { status: 409 }
      );
    }

    try {
      await sendVerificationEmail(accessRequest.email, accessRequest.name, newToken);
    } catch (error) {
      await prisma.accessRequest.updateMany({
        where: {
          id: requestId,
          verificationTokenHash: newTokenHash,
          status: 'verification_email_sending',
        },
        data: {
          status: 'verification_email_failed',
          provisioningState: 'verification_email_failed',
          provisioningError: 'Verification email delivery failed',
        },
      }).catch((stateError: unknown) => {
        appLogger.error('Failed to record verification resend failure', {
          requestId,
          stateError: stateError instanceof Error ? stateError.message : 'Unknown error',
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

    let completionCount = 0;
    try {
      const completion = await prisma.accessRequest.updateMany({
        where: {
          id: requestId,
          verificationTokenHash: newTokenHash,
          status: 'verification_email_sending',
          isVerified: false,
        },
        data: {
          status: 'pending_verification',
          provisioningState: null,
          provisioningError: null,
        },
      });
      completionCount = completion.count;
    } catch (stateError) {
      appLogger.error('Verification resend delivered but completion state update failed', {
        requestId,
        stateError: stateError instanceof Error ? stateError.message : 'Unknown error',
      });
    }

    if (completionCount !== 1) {
      appLogger.error('Verification resend completed but state transition was not claimed', {
        requestId,
      });
      return NextResponse.json(
        {
          success: false,
          message: 'Verification email sent; its state will be recoverable after the delivery lease expires.',
        },
        { status: 202 }
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
