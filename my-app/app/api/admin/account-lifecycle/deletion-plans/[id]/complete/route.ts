import { NextRequest, NextResponse } from 'next/server';

import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { getIpAddress, getUserAgent, logAuditAction, AuditCategories } from '@/lib/audit-log';
import { isProductionCloneReadOnly } from '@/lib/clone-safety';
import { refreshReviewedDeletionPlanAggregate, REVIEWED_DELETION_PLAN_POLICY_VERSION } from '@/lib/lifecycle-deletion-plan';
import { appLogger } from '@/lib/logger';
import { prisma } from '@/lib/prisma';
import { actorHasPermission } from '@/lib/rbac/core';

const TERMINAL_STATUSES = new Set(['completed', 'failed', 'partial']);

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actorHasPermission(admin, 'lifecycle.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  if (isProductionCloneReadOnly()) {
    return NextResponse.json({ error: 'Lifecycle mutations are disabled in this production-clone environment.', code: 'CLONE_READ_ONLY' }, { status: 409 });
  }
  const { id } = await params;
  const plan = await prisma.accountLifecycleBatch.findUnique({ where: { id } });
  if (!plan || plan.policyVersion !== REVIEWED_DELETION_PLAN_POLICY_VERSION) {
    return NextResponse.json({ error: 'Deletion plan not found' }, { status: 404 });
  }
  if (plan.requestedBy !== admin.username) {
    return NextResponse.json({ error: 'Only the confirming operator may finalize this deletion plan.' }, { status: 403 });
  }
  if (TERMINAL_STATUSES.has(plan.status)) {
    return NextResponse.json({ plan, resultSummary: plan.resultSummary, replayed: true });
  }

  const updated = await prisma.$transaction(async (tx) => {
    const current = await tx.accountLifecycleBatch.findUnique({ where: { id } });
    if (!current || current.requestedBy !== admin.username) return null;
    if (TERMINAL_STATUSES.has(current.status)) return current;
    return refreshReviewedDeletionPlanAggregate(tx, id, { finalizationRequested: true });
  });
  if (!updated) return NextResponse.json({ error: 'Deletion plan not found' }, { status: 404 });

  try {
    await logAuditAction({
      action: 'finalize_lifecycle_deletion_plan',
      category: AuditCategories.LIFECYCLE,
      username: admin.username,
      targetId: id,
      targetType: 'AccountLifecycleBatch',
      success: updated.status === 'completed',
      details: updated.resultSummary && typeof updated.resultSummary === 'object' && !Array.isArray(updated.resultSummary)
        ? updated.resultSummary
        : { derivedFromPersistedActions: true },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    });
  } catch (auditError) {
    appLogger.error('Deletion plan finalization audit emission failed after durable aggregation', auditError, { planId: id });
  }
  return NextResponse.json({ plan: updated, resultSummary: updated.resultSummary, replayed: false });
}
