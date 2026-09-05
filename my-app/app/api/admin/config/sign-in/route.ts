import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { AuditActions, AuditCategories, emitAuditActionLog, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { clearConfigCache } from '@/lib/config/resolver';
import { normalizeRevisionReason } from '@/lib/config/revisions';
import {
  SIGN_IN_POLICY_KEY,
  asInputJson,
  getPortalSignInPolicy,
  type PortalSignInPolicy,
  validateUsablePortalSignInPolicy,
} from '@/lib/auth/sign-in-policy';
import { prisma } from '@/lib/prisma';
import { actorHasPermission } from '@/lib/rbac/core';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseJsonWithLimit } from '@/lib/validation';
import { probeOidcProviderAvailability } from '@/lib/auth/oidc';

export const dynamic = 'force-dynamic';

class SignInPolicyConflictError extends Error {}

async function responseBody() {
  const resolved = await getPortalSignInPolicy();
  const oidc = resolved.methods.find((method) => method.id === 'oidc');
  const providerStatus = oidc?.enabled && oidc.ready
    ? await probeOidcProviderAvailability().catch(() => ({
        available: false as const,
        reason: 'unknown_failure' as const,
        qualifiesForOutageFallback: false,
      }))
    : null;
  return { ...resolved, providerStatus };
}

async function authorize(request: NextRequest) {
  const auth = await checkAdminAuthWithRateLimit(request);
  if (!auth.admin || auth.response) {
    return { admin: null, response: auth.response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!actorHasPermission(auth.admin, 'settings.manage')) {
    return { admin: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { admin: auth.admin, response: null };
}

export async function GET(request: NextRequest) {
  const { admin, response } = await authorize(request);
  if (!admin || response) return response;
  try {
    return NextResponse.json(await responseBody());
  } catch (error) {
    console.error('Failed to load portal sign-in policy:', error);
    return NextResponse.json({ error: 'The sign-in policy is invalid or unavailable.' }, { status: 503 });
  }
}

export async function PUT(request: NextRequest) {
  const { admin, response } = await authorize(request);
  if (!admin || response) return response;

  try {
    const body = await parseJsonWithLimit<{ policy?: unknown; reason?: unknown; expectedRevision?: unknown }>(
      request,
      MAX_REQUEST_BODY_SIZE.SMALL
    );
    if (
      !body
      || typeof body !== 'object'
      || Array.isArray(body)
      || !Object.prototype.hasOwnProperty.call(body, 'expectedRevision')
      || (body.expectedRevision !== null && typeof body.expectedRevision !== 'string')
    ) {
      return NextResponse.json({ error: 'expectedRevision must be the loaded revision or null' }, { status: 400 });
    }
    const expectedRevision = body.expectedRevision;
    let policy: PortalSignInPolicy;
    try {
      policy = await validateUsablePortalSignInPolicy(body.policy);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : 'Invalid sign-in policy' },
        { status: 400 }
      );
    }

    const reason = normalizeRevisionReason(body.reason);
    const auditEntry = {
      action: AuditActions.UPDATE_SETTINGS,
      category: AuditCategories.SETTINGS,
      username: admin.username,
      targetType: 'SystemConfigEntry',
      targetId: SIGN_IN_POLICY_KEY,
      eventKind: 'write',
      outcome: 'success',
      details: {
        key: SIGN_IN_POLICY_KEY,
        enabledMethods: [
          ...(policy.methods.oidc.enabled ? ['oidc'] : []),
          ...(policy.methods.nativeAd.enabled ? ['native_ad'] : []),
          ...(policy.methods.local.enabled ? ['local_break_glass'] : []),
        ],
      },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    } as const;

    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw<Array<{ lock_acquired: string }>>`
        SELECT 'locked'::text AS lock_acquired
        FROM pg_advisory_xact_lock(hashtextextended(${SIGN_IN_POLICY_KEY}, 771924))
      `;
      // Recheck readiness while policy writes and local-account disablement
      // are serialized through the shared policy lock.
      policy = await validateUsablePortalSignInPolicy(policy);
      const transactionValue = asInputJson(policy);
      const previous = await tx.systemConfigEntry.findUnique({
        where: { key: SIGN_IN_POLICY_KEY },
        select: { value: true, updatedAt: true },
      });
      const currentRevision = previous?.updatedAt.toISOString() ?? null;
      if (currentRevision !== expectedRevision) {
        throw new SignInPolicyConflictError('The sign-in policy changed after it was loaded');
      }
      await tx.systemConfigEntry.upsert({
        where: { key: SIGN_IN_POLICY_KEY },
        update: { value: transactionValue, updatedBy: admin.username },
        create: { key: SIGN_IN_POLICY_KEY, value: transactionValue, updatedBy: admin.username },
      });
      await tx.configurationRevision.create({
        data: {
          key: SIGN_IN_POLICY_KEY,
          previousValue: previous?.value as Prisma.InputJsonValue ?? Prisma.DbNull,
          newValue: transactionValue,
          changeKind: 'update',
          changedBy: admin.username,
          reason,
        },
      });
      await logAuditAction(auditEntry, tx, { emitOperationalLog: false });
    });
    clearConfigCache();
    emitAuditActionLog(auditEntry);
    return NextResponse.json(await responseBody());
  } catch (error) {
    if (error instanceof SignInPolicyConflictError) {
      return NextResponse.json(
        { error: 'The sign-in policy changed after it was loaded. Reload and review the latest policy.' },
        { status: 409 },
      );
    }
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Failed to update portal sign-in policy:', error);
    return NextResponse.json({ error: 'Failed to update sign-in policy' }, { status: 500 });
  }
}
