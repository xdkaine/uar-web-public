import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';

import { prisma } from '@/lib/prisma';
import { emitFlowEvent, startFlowRunFromSource, type FlowContext } from '@/lib/flow/engine';

function jsonContext(context: FlowContext): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(context)) as Prisma.InputJsonValue;
}

export async function enqueueFlowEvent(
  tx: Prisma.TransactionClient,
  input: { triggerKey: string; eventKey: string; context: FlowContext }
): Promise<{ id: string }> {
  return tx.flowEventOutbox.create({
    data: {
      triggerKey: input.triggerKey,
      eventKey: input.eventKey,
      context: jsonContext(input.context),
    },
    select: { id: true },
  });
}

/**
 * Commit a source transition with its owning domain-state transaction. The
 * durable outbox row is graph/source/handle specific, so retry cannot
 * broadcast the transition to another workflow version.
 */
export async function enqueueTargetedFlowSourceEvent(
  tx: Prisma.TransactionClient,
  input: {
    graphId: string;
    sourceNodeId: string;
    sourceHandle: string;
    eventKey: string;
    context: FlowContext;
  }
): Promise<{ id: string }> {
  return tx.flowEventOutbox.create({
    data: {
      triggerKey: 'targeted_source',
      graphId: input.graphId,
      sourceNodeId: input.sourceNodeId,
      sourceHandle: input.sourceHandle,
      eventKey: input.eventKey,
      context: jsonContext(input.context),
    },
    select: { id: true },
  });
}

export async function deliverFlowEventOutboxById(id: string): Promise<boolean> {
  const now = new Date();
  const lockToken = randomUUID();
  const lockedUntil = new Date(now.getTime() + 15 * 60_000);
  const claim = await prisma.flowEventOutbox.updateMany({
    where: {
      id,
      processedAt: null,
      nextAttemptAt: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
    },
    data: { lockToken, lockedUntil },
  });
  if (claim.count !== 1) return false;

  const event = await prisma.flowEventOutbox.findUnique({ where: { id } });
  if (!event || event.processedAt || event.lockToken !== lockToken) return false;
  try {
    const targetedFields = [event.graphId, event.sourceNodeId, event.sourceHandle];
    if (targetedFields.some(Boolean) && !targetedFields.every(Boolean)) {
      throw new Error('Targeted workflow event has incomplete routing metadata');
    }
    if (event.graphId && event.sourceNodeId && event.sourceHandle) {
      const accepted = await startFlowRunFromSource(
        event.graphId,
        event.sourceNodeId,
        event.sourceHandle,
        event.eventKey,
        event.context as FlowContext,
        { acceptedWhileActive: true }
      );
      if (!accepted) throw new Error('Target workflow version is unavailable');
    } else {
      await emitFlowEvent(event.triggerKey, event.eventKey, event.context as FlowContext, { throwOnInfrastructureFailure: true });
    }
    const completed = await prisma.flowEventOutbox.updateMany({
      where: { id: event.id, processedAt: null, lockToken },
      data: {
        processedAt: new Date(),
        attempts: { increment: 1 },
        lastError: null,
        lockToken: null,
        lockedUntil: null,
      },
    });
    return completed.count === 1;
  } catch (error) {
    const attempts = event.attempts + 1;
    const delayMinutes = Math.min(60, 2 ** Math.min(attempts, 6));
    await prisma.flowEventOutbox.updateMany({
      where: { id: event.id, processedAt: null, lockToken },
      data: {
        attempts: { increment: 1 },
        lastError: (error instanceof Error ? error.message : 'Workflow event delivery failed').slice(0, 1000),
        nextAttemptAt: new Date(Date.now() + delayMinutes * 60_000),
        lockToken: null,
        lockedUntil: null,
      },
    });
    return false;
  }
}

export async function drainFlowEventOutbox(limit = 50): Promise<{ processed: number; failed: number }> {
  const due = await prisma.flowEventOutbox.findMany({
    where: {
      processedAt: null,
      nextAttemptAt: { lte: new Date() },
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: new Date() } }],
    },
    select: { id: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  });
  let processed = 0;
  let failed = 0;
  for (const event of due) {
    if (await deliverFlowEventOutboxById(event.id)) processed += 1;
    else failed += 1;
  }
  return { processed, failed };
}
