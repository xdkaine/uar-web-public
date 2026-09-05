import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { parseAdminJson, isJsonBodyError, MAX_REQUEST_BODY_SIZE } from '@/lib/admin-json-parser';
import {
  logAuditAction,
  emitAuditActionLog,
  AuditActions,
  AuditCategories,
  getIpAddress,
  getUserAgent,
  type AuditLogEntry,
} from '@/lib/audit-log';
import { processProviderLogoutTask } from '@/lib/auth/provider-logout-audit';
import { resumeAuthorizedFlowActionAttempt } from '@/lib/flow/engine';

type RecoveryBody = {
  kind?: 'timer' | 'action_attempt' | 'email_attempt' | 'provider_logout';
  id?: string;
  resolution?: 'not_executed' | 'not_delivered' | 'retry_authorized';
  evidence?: string;
};

class WorkflowRecoveryConflictError extends Error {}

function recoveryAuditEntry(
  request: NextRequest,
  username: string,
  body: RecoveryBody,
  recoveryIncomplete: boolean,
  phase: 'authorization' | 'outcome' = 'outcome',
  evidence?: string,
): AuditLogEntry {
  return {
    action: AuditActions.RECONCILE_WORKFLOW_OPERATION,
    category: AuditCategories.CONFIGURATION,
    username,
    targetId: body.id,
    targetType: body.kind,
    eventKind: 'write',
    outcome: recoveryIncomplete ? 'pending' : 'success',
    details: {
      resolution: body.resolution,
      evidenceProvided: true,
      recoveryIncomplete,
      phase,
      ...(phase === 'authorization' ? { evidence } : {}),
    },
    ipAddress: getIpAddress(request),
    userAgent: getUserAgent(request),
  };
}

async function requireAutomationManager(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) return { admin: null, response: response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  if (!actorHasPermission(admin, 'automation.manage')) {
    return { admin: null, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  return { admin, response: null };
}

export async function GET(request: NextRequest) {
  const { admin, response } = await requireAutomationManager(request);
  if (!admin || response) return response!;
  const canRevokeSessions = actorHasPermission(admin, 'sessions.revoke');

  const [timers, emailAttempts, providerLogouts] = await Promise.all([
    prisma.flowTimer.findMany({
      where: { status: 'reconciliation_required' },
      orderBy: { dueAt: 'asc' },
      take: 100,
      select: {
        id: true,
        runId: true,
        nodeId: true,
        dueAt: true,
        attempts: true,
        lastError: true,
        run: { select: { graph: { select: { name: true, version: true } } } },
      },
    }),
    prisma.flowActionAttempt.findMany({
      where: { status: { in: ['delivery_unknown', 'reconciliation_required'] } },
      orderBy: { updatedAt: 'asc' },
      take: 100,
      select: {
        id: true,
        runId: true,
        nodeId: true,
        kind: true,
        status: true,
        attempts: true,
        lastError: true,
        updatedAt: true,
      },
    }),
    canRevokeSessions ? prisma.providerLogoutTask.findMany({
      where: { status: 'reconciliation_required' },
      orderBy: { updatedAt: 'asc' },
      take: 100,
      select: {
        id: true,
        username: true,
        reason: true,
        status: true,
        claimedUntil: true,
        attempts: true,
        lastError: true,
        updatedAt: true,
      },
    }) : Promise.resolve([]),
  ]);

  return NextResponse.json({ timers, emailAttempts, providerLogouts });
}

export async function POST(request: NextRequest) {
  const { admin, response } = await requireAutomationManager(request);
  if (!admin || response) return response!;

  try {
    const body = await parseAdminJson<RecoveryBody>(request, MAX_REQUEST_BODY_SIZE.SMALL);
    const evidence = body.evidence?.trim() || '';
    if (!body.id || evidence.length < 10) {
      return NextResponse.json({ error: 'A target and at least 10 characters of evidence are required' }, { status: 400 });
    }
    if (body.kind === 'provider_logout' && !actorHasPermission(admin, 'sessions.revoke')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    let recoveryIncomplete = false;
    let incompleteMessage: string | null = null;
    let auditRecorded = false;
    let outcomeAuditNeeded = false;

    if (body.kind === 'timer' && body.resolution === 'not_executed') {
      const auditEntry = recoveryAuditEntry(request, admin.username, body, false);
      let recoveryResult: 'not_found' | 'updated';
      try {
        recoveryResult = await prisma.$transaction(async (tx) => {
          const timer = await tx.flowTimer.findUnique({ where: { id: body.id }, select: { runId: true } });
          if (!timer) return 'not_found' as const;
          const updated = await tx.flowTimer.updateMany({
            where: { id: body.id, status: 'reconciliation_required' },
            data: {
              status: 'pending',
              dueAt: new Date(),
              claimId: null,
              claimedAt: null,
              claimedUntil: null,
              lastError: `Retry authorized by ${admin.username}: ${evidence}`,
            },
          });
          if (updated.count !== 1) throw new WorkflowRecoveryConflictError();
          const runUpdated = await tx.flowRun.updateMany({
            where: { id: timer.runId, status: 'reconciliation_required' },
            data: { status: 'waiting', error: null },
          });
          if (runUpdated.count !== 1) throw new WorkflowRecoveryConflictError();
          await logAuditAction(auditEntry, tx, { emitOperationalLog: false });
          return 'updated' as const;
        });
      } catch (error) {
        if (error instanceof WorkflowRecoveryConflictError) {
          return NextResponse.json({ error: 'Workflow timer recovery conflict' }, { status: 409 });
        }
        throw error;
      }
      if (recoveryResult === 'not_found') return NextResponse.json({ error: 'Workflow timer not found' }, { status: 404 });
      auditRecorded = true;
      try {
        emitAuditActionLog(auditEntry);
      } catch {
        // The durable audit row committed with the recovery state. Logging must
        // not turn that committed success into a retryable HTTP failure.
      }
    } else if (
      (body.kind === 'email_attempt' && body.resolution === 'not_delivered')
      || (body.kind === 'action_attempt' && body.resolution === 'not_executed')
    ) {
      const authorizationAudit = recoveryAuditEntry(
        request,
        admin.username,
        body,
        true,
        'authorization',
        evidence,
      );
      try {
        await prisma.$transaction(async (tx) => {
          const updated = await tx.flowActionAttempt.updateMany({
            where: {
              id: body.id,
              status: body.kind === 'email_attempt' ? 'delivery_unknown' : 'reconciliation_required',
            },
            data: {
              status: 'retry_authorized',
              claimId: null,
              claimedUntil: null,
              outcome: { resolution: body.resolution, evidence, actor: admin.username, at: new Date().toISOString() },
              lastError: `Operator confirmed ${body.resolution === 'not_delivered' ? 'non-delivery' : 'no action execution'}: ${evidence}`,
            },
          });
          if (updated.count !== 1) throw new WorkflowRecoveryConflictError();
          await logAuditAction(authorizationAudit, tx, { emitOperationalLog: false });
        });
      } catch (error) {
        if (error instanceof WorkflowRecoveryConflictError) {
          return NextResponse.json({ error: 'Workflow action recovery conflict' }, { status: 409 });
        }
        throw error;
      }
      auditRecorded = true;
      outcomeAuditNeeded = true;
      try {
        emitAuditActionLog(authorizationAudit);
      } catch {
        // Durable authorization evidence already committed.
      }
      const resumed = await resumeAuthorizedFlowActionAttempt(body.id);
      if (!resumed) {
        recoveryIncomplete = true;
        incompleteMessage = 'The retry was authorized but the workflow still requires recovery; the scheduler will retry only if the durable claim remains eligible.';
      }
    } else if (body.kind === 'provider_logout' && body.resolution === 'retry_authorized') {
      const authorizationAudit = recoveryAuditEntry(
        request,
        admin.username,
        body,
        true,
        'authorization',
        evidence,
      );
      try {
        await prisma.$transaction(async (tx) => {
          const updated = await tx.providerLogoutTask.updateMany({
            where: { id: body.id, status: 'reconciliation_required' },
            data: {
              status: 'pending',
              claimId: null,
              claimedUntil: null,
              lastError: `Retry authorized by ${admin.username}: ${evidence}`,
            },
          });
          if (updated.count !== 1) throw new WorkflowRecoveryConflictError();
          await logAuditAction(authorizationAudit, tx, { emitOperationalLog: false });
        });
      } catch (error) {
        if (error instanceof WorkflowRecoveryConflictError) {
          return NextResponse.json({ error: 'Provider logout recovery conflict' }, { status: 409 });
        }
        throw error;
      }
      auditRecorded = true;
      outcomeAuditNeeded = true;
      try {
        emitAuditActionLog(authorizationAudit);
      } catch {
        // Durable authorization evidence already committed.
      }
      const result = await processProviderLogoutTask(body.id);
      recoveryIncomplete = !result.destroyed;
      if (recoveryIncomplete) incompleteMessage = 'Provider logout still requires reconciliation';
    } else {
      return NextResponse.json({ error: 'Unsupported recovery resolution' }, { status: 400 });
    }

    if (!auditRecorded) {
      await logAuditAction(recoveryAuditEntry(request, admin.username, body, recoveryIncomplete));
    } else if (outcomeAuditNeeded) {
      try {
        await logAuditAction(recoveryAuditEntry(request, admin.username, body, recoveryIncomplete));
      } catch {
        // The authorization evidence is durable and the processor has already
        // recorded its resulting state. Do not invite an unsafe duplicate retry.
      }
    }
    return NextResponse.json(
      recoveryIncomplete
        ? { success: false, error: incompleteMessage }
        : { success: true },
      { status: recoveryIncomplete ? 202 : 200 }
    );
  } catch (error) {
    if (isJsonBodyError(error)) return NextResponse.json({ error: error.message }, { status: error.statusCode });
    return NextResponse.json({ error: 'Failed to reconcile workflow operation' }, { status: 500 });
  }
}
