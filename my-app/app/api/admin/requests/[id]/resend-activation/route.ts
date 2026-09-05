import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { randomBytes, createHash } from 'crypto';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { sendAccountActivationEmail } from '@/lib/email';
import { appLogger } from '@/lib/logger';
import {
    AuditActions,
    AuditCategories,
    getIpAddress,
    getUserAgent,
    logAuditAction,
} from '@/lib/audit-log';

const ACTIVATION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;

class HttpError extends Error {
    status: number;

    constructor(message: string, status = 400) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
    }
}

type PreviousActivationToken = {
    tokenHash: string;
    expiresAt: Date;
    used: boolean;
    usedAt: Date | null;
    attempts: number;
    ipAddress: string | null;
    userAgent: string | null;
    createdAt: Date;
};

/**
 * Admin endpoint to resend an activation email for an internal access request
 * POST /api/admin/requests/[id]/resend-activation
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

        // Generate new token
        const activationToken = randomBytes(32).toString('hex');
        const tokenHash = createHash('sha256').update(activationToken).digest('hex');
        const now = new Date();
        const expiresAt = new Date(now.getTime() + ACTIVATION_TOKEN_TTL_MS);

        const resendState = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
            const accessRequest = await tx.accessRequest.findUnique({
                where: { id: requestId },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    status: true,
                    isInternal: true,
                    ldapUsername: true,
                    version: true,
                    activationToken: {
                        select: {
                            tokenHash: true,
                            expiresAt: true,
                            used: true,
                            usedAt: true,
                            attempts: true,
                            ipAddress: true,
                            userAgent: true,
                            createdAt: true,
                        },
                    },
                },
            });

            if (!accessRequest) {
                throw new HttpError('Request not found', 404);
            }

            // Validation checks
            if (!accessRequest.isInternal) {
                throw new HttpError('Activation emails can only be sent for internal users');
            }

            if (accessRequest.status !== 'approved') {
                throw new HttpError('Activation emails can only be sent for approved requests');
            }

            if (!accessRequest.ldapUsername) {
                throw new HttpError('Cannot send activation email: LDAP username is missing');
            }

            if (
                accessRequest.activationToken &&
                accessRequest.activationToken.createdAt.getTime() > now.getTime() - RESEND_COOLDOWN_MS
            ) {
                throw new HttpError(
                    'Activation email was just resent. Please wait a moment before trying again.',
                    429
                );
            }

            const claim = await tx.accessRequest.updateMany({
                where: {
                    id: requestId,
                    version: accessRequest.version,
                    status: 'approved',
                    isInternal: true,
                },
                data: {
                    version: { increment: 1 },
                },
            });

            if (claim.count !== 1) {
                throw new HttpError(
                    'This request was modified by another administrator. Please refresh and try again.',
                    409
                );
            }

            const previousToken: PreviousActivationToken | null = accessRequest.activationToken
                ? {
                    tokenHash: accessRequest.activationToken.tokenHash,
                    expiresAt: accessRequest.activationToken.expiresAt,
                    used: accessRequest.activationToken.used,
                    usedAt: accessRequest.activationToken.usedAt,
                    attempts: accessRequest.activationToken.attempts,
                    ipAddress: accessRequest.activationToken.ipAddress,
                    userAgent: accessRequest.activationToken.userAgent,
                    createdAt: accessRequest.activationToken.createdAt,
                }
                : null;

            // Upsert the token (update if exists, create if not).
            // Reset used/attempt state so only the newly emailed token is valid.
            await tx.accountActivationToken.upsert({
                where: { accessRequestId: requestId },
                update: {
                    tokenHash,
                    expiresAt,
                    used: false,
                    usedAt: null,
                    attempts: 0,
                    ipAddress: null,
                    userAgent: null,
                    createdAt: now,
                },
                create: {
                    accessRequestId: requestId,
                    tokenHash,
                    expiresAt,
                },
            });

            return {
                accessRequest: {
                    id: accessRequest.id,
                    name: accessRequest.name,
                    email: accessRequest.email,
                    ldapUsername: accessRequest.ldapUsername,
                },
                previousToken,
            };
        }, {
            isolationLevel: 'Serializable',
            timeout: 10000,
        });

        try {
            await sendAccountActivationEmail(
                resendState.accessRequest.email,
                resendState.accessRequest.name,
                resendState.accessRequest.ldapUsername,
                activationToken,
                expiresAt
            );
        } catch (emailError) {
            if (resendState.previousToken) {
                const rollback = await prisma.accountActivationToken.updateMany({
                    where: {
                        accessRequestId: requestId,
                        tokenHash,
                    },
                    data: {
                        tokenHash: resendState.previousToken.tokenHash,
                        expiresAt: resendState.previousToken.expiresAt,
                        used: resendState.previousToken.used,
                        usedAt: resendState.previousToken.usedAt,
                        attempts: resendState.previousToken.attempts,
                        ipAddress: resendState.previousToken.ipAddress,
                        userAgent: resendState.previousToken.userAgent,
                        createdAt: resendState.previousToken.createdAt,
                    },
                });

                if (rollback.count === 0) {
                    appLogger.warn('Skipped activation token rollback because a newer token replaced it', {
                        requestId,
                    });
                }
            } else {
                const rollback = await prisma.accountActivationToken.deleteMany({
                    where: {
                        accessRequestId: requestId,
                        tokenHash,
                    },
                });

                if (rollback.count === 0) {
                    appLogger.warn('Skipped activation token delete because a newer token replaced it', {
                        requestId,
                    });
                }
            }

            appLogger.error('Failed to send activation email', {
                requestId,
                error: emailError instanceof Error ? emailError.message : 'Unknown error',
            });

            try {
                await logAuditAction({
                    action: AuditActions.ACCOUNT_ACTIVATION_TOKEN_ROLLED_BACK,
                    category: AuditCategories.ACCESS_REQUEST,
                    username: admin.username,
                    actorType: 'admin',
                    targetId: requestId,
                    targetType: 'AccessRequest',
                    subjectUsername: resendState.accessRequest.ldapUsername,
                    subjectEmail: resendState.accessRequest.email,
                    relatedRequestId: requestId,
                    eventKind: 'notification',
                    outcome: 'rollback',
                    success: false,
                    errorMessage: emailError instanceof Error ? emailError.message : 'Unknown error',
                    details: {
                        reason: 'activation_email_send_failed',
                        hadPreviousToken: Boolean(resendState.previousToken),
                    },
                    ipAddress: getIpAddress(request),
                    userAgent: getUserAgent(request),
                });
            } catch (auditError) {
                appLogger.error('Failed to audit activation email rollback', {
                    requestId,
                    error: auditError instanceof Error ? auditError.message : 'Unknown error',
                });
            }

            return NextResponse.json(
                { error: 'Failed to send activation email' },
                { status: 500 }
            );
        }

        appLogger.info('Activation email resent', {
            requestId,
            adminUser: admin.username,
            email: resendState.accessRequest.email,
        });

        await prisma.accessRequest.updateMany({
            where: {
                id: requestId,
                provisioningState: 'activation_email_pending',
            },
            data: {
                provisioningState: null,
                provisioningCompletedAt: new Date(),
                provisioningError: null,
            },
        });

        try {
            await logAuditAction({
                action: AuditActions.RESEND_ACTIVATION_EMAIL || 'RESEND_ACTIVATION_EMAIL', // Fallback if enum not updated yet
                category: AuditCategories.ACCESS_REQUEST,
                username: admin.username,
                actorType: 'admin',
                targetId: requestId,
                targetType: 'AccessRequest',
                subjectUsername: resendState.accessRequest.ldapUsername,
                subjectEmail: resendState.accessRequest.email,
                relatedRequestId: requestId,
                eventKind: 'notification',
                outcome: 'success',
                details: {
                    email: resendState.accessRequest.email,
                    name: resendState.accessRequest.name,
                    username: resendState.accessRequest.ldapUsername,
                },
                ipAddress: getIpAddress(request),
                userAgent: getUserAgent(request),
            });
        } catch (auditError) {
            appLogger.error('Failed to audit activation email resend after successful send', {
                requestId,
                error: auditError instanceof Error ? auditError.message : 'Unknown error',
            });
        }

        return NextResponse.json({
            success: true,
            message: 'Activation email sent successfully',
        });

    } catch (error) {
        if (error instanceof HttpError) {
            return NextResponse.json({ error: error.message }, { status: error.status });
        }

        if (error && typeof error === 'object' && 'code' in error) {
            const prismaError = error as { code: string };
            if (prismaError.code === 'P2034') {
                return NextResponse.json(
                    {
                        error:
                            'Another administrator is currently processing this request. Please refresh and try again.',
                    },
                    { status: 409 }
                );
            }
        }

        appLogger.error('Unexpected error resending activation', {
            error: error instanceof Error ? error.message : 'Unknown error',
        });

        return NextResponse.json(
            { error: 'An unexpected error occurred' },
            { status: 500 }
        );
    }
}
