import { NextRequest, NextResponse } from 'next/server';

import { checkReviewAccessWithRateLimit } from '@/lib/adminAuth';
import { AuditActions, AuditCategories, getIpAddress, getUserAgent, logAuditAction } from '@/lib/audit-log';
import { searchLDAPUser } from '@/lib/ldap';
import { prisma } from '@/lib/prisma';
import { actorHasPermission } from '@/lib/rbac/core';

type AccountUpdateOutcome = {
  oldLdapUsername?: string;
  oldVpnUsername?: string | null;
  newLdapUsername?: string;
  newVpnUsername?: string | null;
  attemptedSteps?: string[];
  completedSteps?: string[];
};

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { admin, response } = await checkReviewAccessWithRateLimit(request);
  if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actorHasPermission(admin, 'access_requests.provision')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const { id } = await params;
  const body = await request.json() as { resolution?: unknown; evidence?: unknown };
  if (body.resolution !== 'not_applied') {
    return NextResponse.json(
      { error: 'Only a verified not_applied outcome can be re-armed automatically' },
      { status: 400 }
    );
  }
  const evidence = typeof body.evidence === 'string' ? body.evidence.trim() : '';
  if (evidence.length < 10) {
    return NextResponse.json({ error: 'Reconciliation evidence must contain at least 10 characters' }, { status: 400 });
  }

  const accessRequest = await prisma.accessRequest.findUnique({ where: { id } });
  if (!accessRequest || accessRequest.accountUpdateState !== 'reconciliation_required') {
    return NextResponse.json({ error: 'Account update is not awaiting reconciliation' }, { status: 409 });
  }
  const outcome = (accessRequest.accountUpdateOutcome || {}) as AccountUpdateOutcome;
  if ((outcome.completedSteps?.length ?? 0) > 0) {
    return NextResponse.json(
      { error: 'Completed external steps are recorded; this update cannot be certified as not applied or automatically retried' },
      { status: 409 }
    );
  }
  const oldLdapUsername = outcome.oldLdapUsername || accessRequest.ldapUsername;
  const oldVpnUsername = outcome.oldVpnUsername || accessRequest.vpnUsername;
  const newLdapUsername = outcome.newLdapUsername || accessRequest.accountUpdateTargetLdapUsername;
  const newVpnUsername = outcome.newVpnUsername || accessRequest.accountUpdateTargetVpnUsername;
  if (!oldLdapUsername || !newLdapUsername) {
    return NextResponse.json({ error: 'Stored account-update identity evidence is incomplete' }, { status: 409 });
  }

  if (!await searchLDAPUser(oldLdapUsername)) {
    return NextResponse.json({ error: 'The authoritative source LDAP identity no longer exists' }, { status: 409 });
  }
  if (newLdapUsername !== oldLdapUsername && await searchLDAPUser(newLdapUsername)) {
    return NextResponse.json({ error: 'The LDAP target exists; the operation cannot be certified as not applied' }, { status: 409 });
  }
  if (oldVpnUsername && oldVpnUsername !== oldLdapUsername) {
    if (!await searchLDAPUser(oldVpnUsername)) {
      return NextResponse.json({ error: 'The authoritative source VPN identity no longer exists' }, { status: 409 });
    }
    if (newVpnUsername && newVpnUsername !== oldVpnUsername && await searchLDAPUser(newVpnUsername)) {
      return NextResponse.json({ error: 'The VPN target exists; the operation cannot be certified as not applied' }, { status: 409 });
    }
  }

  const updated = await prisma.accessRequest.updateMany({
    where: { id, version: accessRequest.version, accountUpdateState: 'reconciliation_required' },
    data: {
      accountUpdateState: 'failed',
      accountUpdateClaimId: null,
      accountUpdateClaimedUntil: null,
      accountUpdateTargetLdapUsername: null,
      accountUpdateTargetVpnUsername: null,
      accountUpdateError: `Operator confirmed no directory changes were applied: ${evidence}`,
      accountUpdateOutcome: {
        ...outcome,
        phase: 'reconciled_not_applied',
        resolution: 'not_applied',
        evidence,
        reconciledBy: admin.username,
        reconciledAt: new Date().toISOString(),
      },
      version: { increment: 1 },
    },
  });
  if (updated.count !== 1) {
    return NextResponse.json({ error: 'Account-update reconciliation changed concurrently' }, { status: 409 });
  }

  await prisma.requestComment.create({
    data: {
      requestId: id,
      author: admin.username,
      type: 'system',
      comment: `Account update reconciled as not applied by ${admin.username}. Evidence: ${evidence}`,
    },
  });
  await logAuditAction({
    action: AuditActions.RECONCILE_ACCOUNT_UPDATE,
    category: AuditCategories.ACCESS_REQUEST,
    username: admin.username,
    targetId: id,
    targetType: 'AccessRequest',
    details: { resolution: 'not_applied', evidence, oldLdapUsername, newLdapUsername },
    ipAddress: getIpAddress(request),
    userAgent: getUserAgent(request),
  });

  return NextResponse.json({ success: true, resolution: 'not_applied' });
}
