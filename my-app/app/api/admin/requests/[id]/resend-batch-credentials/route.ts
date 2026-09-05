import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { sendCredentialsEmail } from '@/lib/email';
import { decryptPassword } from '@/lib/encryption';
import { finalizeDeliveredCredential } from '@/lib/batch-credential-lifecycle';
import { logAuditAction, AuditCategories, getIpAddress, getUserAgent } from '@/lib/audit-log';
import { appLogger } from '@/lib/logger';

const DELIVERY_LEASE_MS = 5 * 60 * 1000;
const AMBIGUOUS_DELIVERY_STATES = ['delivery_sending', 'delivery_retrying'] as const;

type ReconciliationOutcome = 'delivered' | 'not_delivered';

function readReconciliationOutcome(body: unknown): ReconciliationOutcome | null {
  if (!body || typeof body !== 'object' || !('reconciliationOutcome' in body)) {
    return null;
  }
  const outcome = (body as { reconciliationOutcome?: unknown }).reconciliationOutcome;
  return outcome === 'delivered' || outcome === 'not_delivered' ? outcome : null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'access_requests.provision')) {
  return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Route parameters and the optional reconciliation payload are independent
  // after authentication. Resolving them together does not begin delivery or
  // change the later claim/audit ordering.
  const [{ id }, body] = await Promise.all([
    params,
    request.json().catch(() => null),
  ]);
  const reconciliationOutcome = readReconciliationOutcome(body);
  const accessRequest = await prisma.accessRequest.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      email: true,
      ldapUsername: true,
      accountPassword: true,
      accountExpiresAt: true,
      provisioningState: true,
      updatedAt: true,
    },
  });

  if (!accessRequest) {
    return NextResponse.json({ error: 'Request not found' }, { status: 404 });
  }

  if (!accessRequest.accountPassword) {
    return NextResponse.json({ error: 'No encrypted credential is available' }, { status: 400 });
  }

  if (
    accessRequest.provisioningState &&
    (AMBIGUOUS_DELIVERY_STATES as readonly string[]).includes(accessRequest.provisioningState)
  ) {
    const staleBefore = new Date(Date.now() - DELIVERY_LEASE_MS);
    if (accessRequest.updatedAt > staleBefore) {
      return NextResponse.json({ error: 'Credential delivery is already in progress' }, { status: 409 });
    }

    const recovered = await prisma.accessRequest.updateMany({
      where: {
        id,
        provisioningState: accessRequest.provisioningState,
        accountPassword: accessRequest.accountPassword,
        updatedAt: accessRequest.updatedAt,
      },
      data: {
        provisioningState: 'delivery_reconciliation_required',
        provisioningError: 'Credential delivery lease expired; delivery outcome is unknown',
      },
    });
    if (recovered.count !== 1) {
      return NextResponse.json({ error: 'Credential delivery state changed' }, { status: 409 });
    }

    await logAuditAction({
      action: 'reconcile_batch_credential_delivery',
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      targetId: id,
      targetType: 'AccessRequest',
      success: false,
      details: { outcome: 'expired_delivery_lease' },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json(
      {
        success: false,
        provisioningState: 'delivery_reconciliation_required',
        message: 'Delivery outcome is unknown; confirm receipt before choosing a reconciliation outcome.',
      },
      { status: 202 }
    );
  }

  if (accessRequest.provisioningState === 'delivery_reconciliation_required') {
    if (!reconciliationOutcome) {
      return NextResponse.json(
        { error: 'reconciliationOutcome must be delivered or not_delivered' },
        { status: 400 }
      );
    }

    let reconciliationState: string;
    if (reconciliationOutcome === 'delivered') {
      reconciliationState = await finalizeDeliveredCredential(
        id,
        accessRequest.accountPassword,
        'delivery_reconciliation_required'
      );
    } else {
      const reset = await prisma.accessRequest.updateMany({
        where: {
          id,
          provisioningState: 'delivery_reconciliation_required',
          accountPassword: accessRequest.accountPassword,
        },
        data: {
          provisioningState: 'delivery_failed',
          provisioningError: 'Administrator confirmed credentials were not delivered',
        },
      });
      if (reset.count === 1) {
        reconciliationState = 'delivery_failed';
      } else {
        const current = await prisma.accessRequest.findUnique({
          where: { id },
          select: { provisioningState: true },
        });
        reconciliationState = current?.provisioningState ?? 'reconciliation_required';
      }
    }

    const reconciliationSucceeded = reconciliationOutcome === 'delivered'
      ? reconciliationState === 'completed'
      : reconciliationState === 'delivery_failed';

    await logAuditAction({
      action: 'reconcile_batch_credential_delivery',
      category: AuditCategories.ACCESS_REQUEST,
      username: admin.username,
      targetId: id,
      targetType: 'AccessRequest',
      success: reconciliationSucceeded,
      details: { confirmedOutcome: reconciliationOutcome, provisioningState: reconciliationState },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });

    return NextResponse.json(
      { success: reconciliationSucceeded, provisioningState: reconciliationState },
      { status: reconciliationSucceeded ? 200 : 202 }
    );
  }

  if (
    accessRequest.provisioningState !== 'delivery_failed' ||
    !accessRequest.ldapUsername ||
    !accessRequest.accountExpiresAt
  ) {
    return NextResponse.json(
      { error: 'Credential resend is available only for a delivery_failed batch request' },
      { status: 400 }
    );
  }

  const claim = await prisma.accessRequest.updateMany({
    where: {
      id,
      provisioningState: 'delivery_failed',
      accountPassword: accessRequest.accountPassword,
    },
    data: {
      provisioningState: 'delivery_retrying',
      provisioningError: null,
    },
  });
  if (claim.count !== 1) {
    return NextResponse.json({ error: 'Credential resend is already in progress' }, { status: 409 });
  }

  let decryptedPassword: string | null = null;
  try {
    decryptedPassword = decryptPassword(accessRequest.accountPassword);
  } catch (error) {
    await prisma.accessRequest.updateMany({
      where: {
        id,
        provisioningState: 'delivery_retrying',
        accountPassword: accessRequest.accountPassword,
      },
      data: {
        provisioningState: 'delivery_failed',
        provisioningError: 'Encrypted credential could not be decrypted',
      },
    }).catch(() => {});
    appLogger.error('Batch credential decryption failed', {
      requestId: id,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return NextResponse.json({ error: 'Credential delivery failed' }, { status: 500 });
  }

  try {
    await sendCredentialsEmail(
      accessRequest.email,
      accessRequest.name,
      accessRequest.ldapUsername,
      decryptedPassword,
      accessRequest.accountExpiresAt
    );
  } catch (error) {
    await prisma.accessRequest.updateMany({
      where: {
        id,
        provisioningState: 'delivery_retrying',
        accountPassword: accessRequest.accountPassword,
      },
      data: {
        provisioningState: 'delivery_reconciliation_required',
        provisioningError: 'Credential delivery outcome is unknown',
      },
    }).catch(() => {});
    appLogger.error('Batch credential resend returned an ambiguous delivery result', {
      requestId: id,
      error: error instanceof Error
        ? error.message.split(decryptedPassword).join('[REDACTED]')
        : 'Unknown error',
    });
    return NextResponse.json(
      {
        success: false,
        provisioningState: 'delivery_reconciliation_required',
        message: 'Credential delivery outcome is unknown and requires reconciliation',
      },
      { status: 202 }
    );
  }

  const finalizationState = await finalizeDeliveredCredential(
    id,
    accessRequest.accountPassword,
    'delivery_retrying'
  );
  await logAuditAction({
    action: 'resend_batch_credentials',
    category: AuditCategories.ACCESS_REQUEST,
    username: admin.username,
    targetId: id,
    targetType: 'AccessRequest',
    success: finalizationState === 'completed',
    details: { provisioningState: finalizationState },
    ipAddress: getIpAddress(request),
    userAgent: getUserAgent(request),
  });

  return NextResponse.json(
    {
      success: finalizationState === 'completed',
      provisioningState: finalizationState,
      message: finalizationState === 'completed'
        ? 'Credentials resent and encrypted credential cleared'
        : 'Credentials resent; encrypted credential cleanup requires reconciliation',
    },
    { status: finalizationState === 'completed' ? 200 : 202 }
  );
}
