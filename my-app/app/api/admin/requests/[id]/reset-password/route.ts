import { NextRequest, NextResponse } from 'next/server';
import { randomBytes, createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { sendPasswordResetEmail } from '@/lib/email';
import { appLogger } from '@/lib/logger';
import {
    AuditActions,
    AuditCategories,
    getIpAddress,
    getUserAgent,
    logAuditAction,
} from '@/lib/audit-log';

/**
 * Admin endpoint to trigger a password reset email for a user
 * POST /api/admin/requests/[id]/reset-password
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
                status: true,
                isInternal: true,
                ldapUsername: true,
            },
        });

        if (!accessRequest) {
            return NextResponse.json({ error: 'Request not found' }, { status: 404 });
        }

        // Validation checks
        if (!accessRequest.ldapUsername) {
            return NextResponse.json(
                { error: 'Cannot reset password: No associated username found' },
                { status: 400 }
            );
        }

        if (accessRequest.status !== 'approved') {
            return NextResponse.json(
                { error: 'Password reset emails can only be sent for approved requests' },
                { status: 400 }
            );
        }

        // Generate reset token
        const resetToken = randomBytes(32).toString('hex');
        const tokenHash = createHash('sha256').update(resetToken).digest('hex');
        const expiresAt = new Date(Date.now() + 1 * 60 * 60 * 1000); // 1 hour expiration

        // Invalidate any existing unused tokens for this email
        // This prevents multiple valid tokens from existing simultaneously
        await prisma.passwordResetToken.updateMany({
            where: {
                email: accessRequest.email,
                used: false,
                expiresAt: {
                    gt: new Date(), // Only invalidate tokens that haven't expired yet
                },
            },
            data: {
                used: true,
                usedAt: new Date(),
            },
        });

        // Create new password reset token
        await prisma.passwordResetToken.create({
            data: {
                email: accessRequest.email,
                tokenHash,
                expiresAt,
            },
        });

        try {
            await sendPasswordResetEmail(accessRequest.email, resetToken, { initiatedByAdmin: true });

            appLogger.info('Password reset email triggered by admin', {
                requestId,
                adminUser: admin.username,
                targetEmail: accessRequest.email,
            });

            await prisma.accessRequest.updateMany({
                where: {
                    id: requestId,
                    provisioningState: 'credentials_email_pending',
                },
                data: {
                    provisioningState: null,
                    provisioningCompletedAt: new Date(),
                    provisioningError: null,
                },
            });

            await logAuditAction({
                action: AuditActions.ADMIN_TRIGGER_PASSWORD_RESET || 'admin_trigger_password_reset',
                category: AuditCategories.USER,
                username: admin.username,
                actorType: 'admin',
                targetId: requestId,
                targetType: 'AccessRequest',
                subjectUsername: accessRequest.ldapUsername,
                subjectEmail: accessRequest.email,
                relatedRequestId: requestId,
                eventKind: 'notification',
                outcome: 'success',
                details: {
                    email: accessRequest.email,
                    name: accessRequest.name,
                    username: accessRequest.ldapUsername,
                },
                ipAddress: getIpAddress(request),
                userAgent: getUserAgent(request),
            });

            return NextResponse.json({
                success: true,
                message: 'Password reset email sent successfully',
            });

        } catch (emailError) {
            appLogger.error('Failed to send password reset email', {
                requestId,
                error: emailError instanceof Error ? emailError.message : 'Unknown error',
            });

            return NextResponse.json(
                { error: 'Failed to send password reset email' },
                { status: 500 }
            );
        }

    } catch (error) {
        appLogger.error('Unexpected error resetting password', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });

        return NextResponse.json(
            { error: 'An unexpected error occurred' },
            { status: 500 }
        );
    }
}
