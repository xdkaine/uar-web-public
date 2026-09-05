import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendAdminNotification } from '@/lib/email';
import { checkRateLimitAsync, getRequiredClientIp, isRateLimitUnavailable, RateLimitPresets } from '@/lib/ratelimit';
import { markNotificationPending } from '@/lib/notification-queue';
import { appLogger } from '@/lib/logger';
import { logActionHistoryEvent } from '@/lib/action-history';
import { AuditActions, AuditCategories, getUserAgent } from '@/lib/audit-log';
import { firstReviewStatus, getActiveWorkflow } from '@/lib/workflow/core';
import { hashAccessRequestVerificationToken } from '@/lib/access-request-verification';

export async function POST(request: NextRequest) {
  try {
    // Apply rate limiting: 10 attempts per hour per IP to prevent token enumeration
    const clientIp = getRequiredClientIp(request);
    const rateLimitIpResult = await checkRateLimitAsync(clientIp, RateLimitPresets.verification);

    const searchParams = request.nextUrl.searchParams;
    const token = searchParams.get('token');

    // Add per-token rate limiting: 3 attempts per token per hour
    const rateLimitTokenResult = await checkRateLimitAsync('verification-token', {
      maxRequests: 3,
      windowMs: 60 * 60 * 1000, // 1 hour
      identifier: token || 'no-token',
    });

    if (!rateLimitIpResult.success || !rateLimitTokenResult.success) {
      return NextResponse.json(
        { error: 'Too many verification attempts. Please try again later.' },
        { status: 429 }
      );
    }

    if (!token) {
      return NextResponse.json(
        { error: 'Invalid verification link' },
        { status: 400 }
      );
    }

    const tokenHash = hashAccessRequestVerificationToken(token);
    const accessRequest = await prisma.accessRequest.findFirst({
      where: { verificationTokenHash: tokenHash },
    });

    if (!accessRequest) {
      await logActionHistoryEvent({
        action: AuditActions.EMAIL_VERIFICATION_FAILED,
        category: AuditCategories.ACCESS_REQUEST,
        username: 'anonymous',
        actorType: 'anonymous',
        eventKind: 'security',
        outcome: 'denied',
        success: false,
        details: { reason: 'invalid_or_expired_link', tokenPresent: Boolean(token) },
        ipAddress: clientIp,
        userAgent: getUserAgent(request),
      });
      return NextResponse.json(
        { error: 'Invalid or expired verification link' },
        { status: 400 }
      );
    }

    // Check if too many verification attempts have been made
    if (accessRequest.verificationAttempts >= 5) {
      await logActionHistoryEvent({
        action: AuditActions.EMAIL_VERIFICATION_FAILED,
        category: AuditCategories.ACCESS_REQUEST,
        username: accessRequest.email,
        actorType: 'user',
        targetId: accessRequest.id,
        targetType: 'AccessRequest',
        subjectEmail: accessRequest.email,
        relatedRequestId: accessRequest.id,
        eventKind: 'security',
        outcome: 'denied',
        success: false,
        details: { reason: 'too_many_attempts' },
        ipAddress: clientIp,
        userAgent: getUserAgent(request),
      });
      return NextResponse.json(
        { error: 'This verification link has been used too many times' },
        { status: 400 }
      );
    }

    if (accessRequest.isVerified) {
      await logActionHistoryEvent({
        action: AuditActions.EMAIL_VERIFICATION_FAILED,
        category: AuditCategories.ACCESS_REQUEST,
        username: accessRequest.email,
        actorType: 'user',
        targetId: accessRequest.id,
        targetType: 'AccessRequest',
        subjectEmail: accessRequest.email,
        relatedRequestId: accessRequest.id,
        eventKind: 'security',
        outcome: 'skipped',
        success: true,
        details: { reason: 'already_verified' },
        ipAddress: clientIp,
        userAgent: getUserAgent(request),
      });
      return NextResponse.json(
        { error: 'This email has already been verified' },
        { status: 400 }
      );
    }

    // Check expiration using the new field if available, otherwise fall back to createdAt (backward compatibility)
    const isExpired = accessRequest.verificationTokenExpiresAt
      ? new Date() > accessRequest.verificationTokenExpiresAt
      : (Date.now() - accessRequest.createdAt.getTime()) > (24 * 60 * 60 * 1000);

    if (isExpired) {
      // Increment attempt counter even for expired tokens
      await prisma.accessRequest.updateMany({
        where: {
          id: accessRequest.id,
          isVerified: false,
          verificationAttempts: { lt: 5 },
          verificationTokenHash: tokenHash,
        },
        data: {
          verificationAttempts: { increment: 1 },
          verificationToken: null,
          verificationTokenHash: null,
          verificationTokenExpiresAt: null,
        },
      }).catch(() => { /* ignore errors */ });
      await logActionHistoryEvent({
        action: AuditActions.EMAIL_VERIFICATION_FAILED,
        category: AuditCategories.ACCESS_REQUEST,
        username: accessRequest.email,
        actorType: 'user',
        targetId: accessRequest.id,
        targetType: 'AccessRequest',
        subjectEmail: accessRequest.email,
        relatedRequestId: accessRequest.id,
        eventKind: 'security',
        outcome: 'denied',
        success: false,
        details: { reason: 'expired_link' },
        ipAddress: clientIp,
        userAgent: getUserAgent(request),
      });
      return NextResponse.json(
        { error: 'This verification link has expired. Please submit a new request.' },
        { status: 400 }
      );
    }

    const verifiedAt = new Date();

    // Land the request in the first review stage of the currently configured
    // governance workflow (defaults to pending_student_directors).
    const workflow = await getActiveWorkflow();
    const firstReviewStatusValue = firstReviewStatus(workflow.stages);

    const claimResult = await prisma.accessRequest.updateMany({
      where: {
        id: accessRequest.id,
        isVerified: false,
        status: {
          in: ['pending_verification', 'verification_email_failed', 'verification_email_sending'],
        },
        verificationAttempts: { lt: 5 },
        verificationTokenHash: tokenHash,
        OR: [
          { verificationTokenExpiresAt: null },
          { verificationTokenExpiresAt: { gt: verifiedAt } },
        ],
      },
      data: {
        isVerified: true,
        verifiedAt,
        verificationAttempts: { increment: 1 },
        status: firstReviewStatusValue,
        provisioningState: null,
        provisioningError: null,
        // Pin the workflow version governing this request from here on.
        workflowVersionId: workflow.id,
        requestTypeKey: workflow.requestTypeKey,
        verificationToken: null,
        verificationTokenHash: null,
        verificationTokenExpiresAt: null,
      },
    });

    if (claimResult.count !== 1) {
      await logActionHistoryEvent({
        action: AuditActions.EMAIL_VERIFICATION_FAILED,
        category: AuditCategories.ACCESS_REQUEST,
        username: accessRequest.email,
        actorType: 'user',
        targetId: accessRequest.id,
        targetType: 'AccessRequest',
        subjectEmail: accessRequest.email,
        relatedRequestId: accessRequest.id,
        eventKind: 'security',
        outcome: 'failure',
        success: false,
        details: { reason: 'claim_conflict' },
        ipAddress: clientIp,
        userAgent: getUserAgent(request),
      });
      return NextResponse.json(
        { error: 'This email has already been verified' },
        { status: 400 }
      );
    }

    await logActionHistoryEvent({
      action: AuditActions.EMAIL_VERIFICATION_COMPLETED,
      category: AuditCategories.ACCESS_REQUEST,
      username: accessRequest.email,
      actorType: 'user',
      targetId: accessRequest.id,
      targetType: 'AccessRequest',
      subjectEmail: accessRequest.email,
      relatedRequestId: accessRequest.id,
      eventKind: 'security',
      outcome: 'success',
      success: true,
      details: { nextStatus: firstReviewStatusValue },
      ipAddress: clientIp,
      userAgent: getUserAgent(request),
    });

    try {
      await sendAdminNotification(
        accessRequest.id,
        accessRequest.name,
        accessRequest.email,
        accessRequest.isInternal,
        accessRequest.needsDomainAccount,
        accessRequest.eventReason || undefined
      );
    } catch (emailError) {
      console.error('Failed to send admin notification email:', emailError);
      appLogger.error('Admin notification failed, marking as pending', {
        requestId: accessRequest.id,
        email: accessRequest.email,
        error: emailError instanceof Error ? emailError.message : 'Unknown error',
      });

      // Mark notification as pending for manual retry
      await markNotificationPending(accessRequest.id);

      // Return informative message to user
      return NextResponse.json(
        {
          message: 'Email verified successfully! Your request is being processed. Admins will be notified shortly.',
          status: 'notification_pending'
        },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { message: 'Email verified successfully!' },
      { status: 200 }
    );
  } catch (error) {
    if (isRateLimitUnavailable(error)) {
      return NextResponse.json(
        { error: 'This service is temporarily unavailable. Please try again later.' },
        { status: 503 }
      );
    }

    console.error('Error verifying request:', error);
    return NextResponse.json(
      { error: 'Failed to process verification. Please try again.' },
      { status: 500 }
    );
  }
}
