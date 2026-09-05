import { NextRequest, NextResponse } from 'next/server';
import { createHash } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { hashPassword } from '@/lib/auth/password-hash';
import { validatePasswordStrength } from '@/lib/password';
import { logAuditAction, getIpAddress, getUserAgent, AuditCategories } from '@/lib/audit-log';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';
import { getPortalSignInPolicy, SIGN_IN_POLICY_KEY } from '@/lib/auth/sign-in-policy';

interface UpdateLocalAccountBody {
  password?: unknown;
  isActive?: unknown;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { admin, response } = await checkAdminAuthWithRateLimit(request);
    if (!admin) {
      return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (!actorHasPermission(admin, 'break_glass.manage')) {
      return NextResponse.json({ error: 'Forbidden - insufficient permissions' }, { status: 403 });
    }

    const resolvedParams = await params;
    const account = await prisma.localAccount.findUnique({
      where: { id: resolvedParams.id },
    });
    if (!account) {
      return NextResponse.json({ error: 'Local account not found' }, { status: 404 });
    }

    let body: UpdateLocalAccountBody;
    try {
      body = await parseJsonWithLimit<UpdateLocalAccountBody>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    } catch (parseError) {
      if (isJsonBodyError(parseError)) {
        return NextResponse.json({ error: parseError.message }, { status: parseError.statusCode });
      }
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const data: {
      passwordHash?: string;
      isActive?: boolean;
    } = {};

    let rotatedPassword = false;
    if ('password' in body && body.password !== null) {
      if (typeof body.password !== 'string' || !body.password) {
        return NextResponse.json({ error: 'password must be a non-empty string' }, { status: 400 });
      }
      const strength = validatePasswordStrength(body.password);
      if (!strength.isValid) {
        return NextResponse.json(
          { error: 'Password does not meet policy', issues: strength.issues },
          { status: 400 }
        );
      }
      data.passwordHash = await hashPassword(body.password);
      rotatedPassword = true;
    }

    if ('isActive' in body) {
      if (typeof body.isActive !== 'boolean') {
        return NextResponse.json({ error: 'isActive must be a boolean' }, { status: 400 });
      }
      data.isActive = body.isActive;
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });
    }

    const shouldRevoke = rotatedPassword || data.isActive === false;
    const updated = await prisma.$transaction(async (tx) => {
      // Policy writes and last-account disablement share this lock. Session
      // minting and credential rotation share the username lock below.
      await tx.$queryRaw<Array<{ lock_acquired: string }>>`
        SELECT 'locked'::text AS lock_acquired
        FROM pg_advisory_xact_lock(hashtextextended(${SIGN_IN_POLICY_KEY}, 771924))
      `;
      const current = await tx.localAccount.findUnique({ where: { id: account.id } });
      if (!current) throw new Error('LOCAL_ACCOUNT_NOT_FOUND');
      const sessionLockIdentity = current.username.trim().toLowerCase();
      await tx.$queryRaw<Array<{ lock_acquired: string }>>`
        SELECT 'locked'::text AS lock_acquired
        FROM pg_advisory_xact_lock(hashtextextended(${sessionLockIdentity}, 771921))
      `;

      if (data.isActive === false && current.isActive) {
        const resolvedPolicy = await getPortalSignInPolicy();
        if (resolvedPolicy.policy.methods.local.enabled) {
          const activeAccounts = await tx.localAccount.count({ where: { isActive: true } });
          if (activeAccounts <= 1) throw new Error('LAST_ENABLED_LOCAL_ACCOUNT');
        }
      }

      const saved = await tx.localAccount.update({
        where: { id: current.id },
        data,
        select: {
          id: true,
          username: true,
          purpose: true,
          isActive: true,
          createdBy: true,
          createdAt: true,
          updatedAt: true,
          lastUsedAt: true,
          lastUsedIp: true,
        },
      });

      if (shouldRevoke) {
        const sessions = await tx.session.findMany({
          where: {
            username: { equals: current.username, mode: 'insensitive' },
            authProvider: { in: ['local', 'local_manual'] },
          },
          select: { id: true, providerSid: true },
        });
        const providerSids = [...new Set(
          sessions.map((session) => session.providerSid).filter((sid): sid is string => Boolean(sid))
        )];
        if (providerSids.length > 0) {
          await tx.providerLogoutTask.createMany({
            data: providerSids.map((providerSid) => ({
              username: current.username,
              providerSid,
              providerSidHash: createHash('sha256').update(providerSid).digest('hex'),
              reason: rotatedPassword ? 'portal_local_password_rotated' : 'portal_local_account_disabled',
            })),
            skipDuplicates: true,
          });
        }
        await tx.session.deleteMany({ where: { id: { in: sessions.map((session) => session.id) } } });
      }

      await logAuditAction({
        action: rotatedPassword ? 'rotate_local_account_password' : 'update_local_account',
        category: AuditCategories.SETTINGS,
        username: admin.username,
        actorType: 'admin',
        eventKind: 'security',
        targetId: current.id,
        targetType: 'LocalAccount',
        details: {
          accountUsername: current.username,
          changedFields: Object.keys(data),
          revokedLocalSessions: shouldRevoke,
        },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      }, tx);
      return saved;
    });

    return NextResponse.json({ account: updated });
  } catch (error) {
    if (error instanceof Error && error.message === 'LAST_ENABLED_LOCAL_ACCOUNT') {
      return NextResponse.json(
        { error: 'Local sign-in is enabled. Enable another portal local account or change the sign-in policy first.' },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message === 'LOCAL_ACCOUNT_NOT_FOUND') {
      return NextResponse.json({ error: 'Local account not found' }, { status: 404 });
    }
    console.error('Error updating local account:', error);
    return NextResponse.json({ error: 'Failed to update local account' }, { status: 500 });
  }
}
