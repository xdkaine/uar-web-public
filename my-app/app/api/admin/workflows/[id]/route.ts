import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { validateGraph } from '@/lib/flow/graph';
import { assertAutomationGroupsEligible } from '@/lib/flow/group-targets';
import { isSeededWorkflowExample, validateWorkflowPublication } from '@/lib/flow/publication-guard';
import { activateWorkflowMonitorChecks, deactivateWorkflowMonitorChecks } from '@/lib/monitoring/workflow-state';
import { logAuditAction, getIpAddress, getUserAgent, AuditCategories, type AuditLogEntry } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

const DESCRIPTION_MAX = 500;

async function loadGraph(request: NextRequest, params: Promise<{ id: string }>) {
  const resolved = await params;
  const graph = await prisma.workflowGraph.findUnique({
    where: { id: resolved.id },
    include: {
      runs: {
        orderBy: { startedAt: 'desc' },
        take: 20,
        select: {
          id: true,
          eventKey: true,
          status: true,
          error: true,
          nodeOutcomes: true,
          startedAt: true,
          finishedAt: true,
        },
      },
    },
  });
  return graph;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'automation.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const graph = await loadGraph(request, params);
  if (!graph) {
    return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
  }
  return NextResponse.json({ graph });
}

interface UpdateBody {
  description?: unknown;
  nodes?: unknown;
  edges?: unknown;
  action?: unknown; // save | publish | create_draft | disable | enable
  expectedUpdatedAt?: unknown;
  expectedActiveGraphId?: unknown;
}

function expectedRevision(body: UpdateBody): Date | null {
  if (typeof body.expectedUpdatedAt !== 'string') return null;
  const revision = new Date(body.expectedUpdatedAt);
  return Number.isNaN(revision.getTime()) ? null : revision;
}

/**
 * Draft edits stay isolated until publish stamps a new version. Publishing
 * re-validates the shape; enabling is an explicit separate audited act.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'automation.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const existing = await prisma.workflowGraph.findUnique({ where: { id: (await params).id } });
    if (!existing) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }

    const body = (await request.json()) as UpdateBody;
    const action = typeof body.action === 'string' ? body.action : 'save';

    if (!['save', 'publish', 'create_draft', 'disable', 'enable'].includes(action)) {
      return NextResponse.json({ error: 'Unsupported workflow action' }, { status: 400 });
    }

    if (isSeededWorkflowExample(existing.id)) {
      return NextResponse.json(
        { error: 'Seeded example workflows are read-only. Clone this example to create a disabled draft you can review and publish.' },
        { status: 409 }
      );
    }

    if (action === 'create_draft') {
      if (existing.status === 'draft') {
        return NextResponse.json({ graph: existing, existingDraft: true });
      }

      let draftResult: { graph: typeof existing; existingDraft: boolean };
      try {
        draftResult = await prisma.$transaction(async (tx) => {
          const currentDraft = await tx.workflowGraph.findFirst({
            where: { name: existing.name, status: 'draft' },
            orderBy: { version: 'desc' },
          });
          if (currentDraft) return { graph: currentDraft, existingDraft: true };

          const latestVersion = await tx.workflowGraph.findFirst({
            where: { name: existing.name },
            orderBy: { version: 'desc' },
            select: { version: true },
          });

          const graph = await tx.workflowGraph.create({
            data: {
              name: existing.name,
              description: existing.description,
              triggerKey: existing.triggerKey,
              nodes: existing.nodes as object,
              edges: existing.edges as object,
              status: 'draft',
              version: (latestVersion?.version ?? existing.version) + 1,
              enabled: false,
              createdBy: admin.username,
              updatedBy: admin.username,
            },
          });
          return { graph, existingDraft: false };
        });
      } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code?: unknown }).code)
          : '';
        if (code !== 'P2002') throw error;
        const concurrentDraft = await prisma.workflowGraph.findFirst({
          where: { name: existing.name, status: 'draft' },
          orderBy: { version: 'desc' },
        });
        if (!concurrentDraft) throw error;
        draftResult = { graph: concurrentDraft, existingDraft: true };
      }

      if (!draftResult.existingDraft) {
        await audit(
          request,
          admin.username,
          'create_workflow_draft',
          draftResult.graph.id,
          draftResult.graph.name
        );
      }
      return NextResponse.json(
        { graph: draftResult.graph, existingDraft: draftResult.existingDraft },
        { status: draftResult.existingDraft ? 200 : 201 }
      );
    }

    if (action === 'disable') {
      if (existing.status !== 'published') {
        return NextResponse.json(
          { error: 'Only a published workflow can be paused' },
          { status: 409 }
        );
      }
      const revision = expectedRevision(body);
      if (!revision) return NextResponse.json({ error: 'Refresh before disabling this workflow.' }, { status: 409 });
      const disabled = await prisma.$transaction(async (tx) => {
        const result = await tx.workflowGraph.updateMany({
          where: { id: existing.id, status: 'published', enabled: true, updatedAt: revision },
          data: { enabled: false, updatedBy: admin.username },
        });
        if (result.count === 1) {
          await deactivateWorkflowMonitorChecks(tx, [existing.id]);
          await audit(request, admin.username, 'disable_workflow_graph', existing.id, existing.name, tx, true);
        }
        return result;
      }, { isolationLevel: 'Serializable' });
      if (disabled.count !== 1) {
        return NextResponse.json({ error: 'The active workflow changed. Refresh before disabling it.' }, { status: 409 });
      }
      const updated = await prisma.workflowGraph.findUnique({ where: { id: existing.id } });
      if (!updated) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
      return NextResponse.json({ graph: updated });
    }

    if (action === 'enable') {
      if (existing.status !== 'published') {
        return NextResponse.json(
          { error: 'Only a published workflow can be resumed' },
          { status: 409 }
        );
      }
      const revision = expectedRevision(body);
      if (!revision || (body.expectedActiveGraphId !== null && typeof body.expectedActiveGraphId !== 'string')) {
        return NextResponse.json({ error: 'Refresh before enabling this workflow.' }, { status: 409 });
      }
      const publicationErrors = validateWorkflowPublication(existing.nodes);
      if (publicationErrors.length > 0) {
        return NextResponse.json({ error: publicationErrors.join('; '), errors: publicationErrors }, { status: 400 });
      }
      await assertAutomationGroupsEligible(prisma, existing.nodes);
      const updated = await prisma.$transaction(async (tx) => {
        const currentActive = await tx.workflowGraph.findFirst({
          where: { name: existing.name, status: 'published', enabled: true },
          select: { id: true },
        });
        if ((currentActive?.id ?? null) !== body.expectedActiveGraphId) {
          throw new Error('WORKFLOW_ACTIVE_VERSION_CHANGED');
        }
        await tx.workflowGraph.updateMany({
          where: {
            name: existing.name,
            status: 'published',
            enabled: true,
            id: { not: existing.id },
          },
          data: { enabled: false, updatedBy: admin.username },
        });
        if (currentActive) await deactivateWorkflowMonitorChecks(tx, [currentActive.id]);
        const enabled = await tx.workflowGraph.updateMany({
          where: { id: existing.id, status: 'published', enabled: false, updatedAt: revision },
          data: { enabled: true, updatedBy: admin.username },
        });
        if (enabled.count !== 1) throw new Error('WORKFLOW_ACTIVE_VERSION_CHANGED');
        await activateWorkflowMonitorChecks(
          tx,
          { id: existing.id, name: existing.name, nodes: existing.nodes },
          admin.username
        );
        const updated = await tx.workflowGraph.findUnique({ where: { id: existing.id } });
        if (!updated) throw new Error('WORKFLOW_ACTIVE_VERSION_CHANGED');
        await audit(request, admin.username, 'enable_workflow_graph', updated.id, updated.name, tx, true);
        return updated;
      }, { isolationLevel: 'Serializable' });
      if (!updated) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
      return NextResponse.json({ graph: updated });
    }

    if (action === 'publish') {
      if (existing.status !== 'draft') {
        return NextResponse.json(
          { error: 'Published workflow versions are immutable. Create a draft to make changes.' },
          { status: 409 }
        );
      }

      const validation = validateGraph(
        body.nodes ?? existing.nodes,
        body.edges ?? existing.edges
      );
      if (!validation.ok) {
        return NextResponse.json({ error: validation.errors.join('; ') }, { status: 400 });
      }
      const publicationErrors = validateWorkflowPublication(body.nodes ?? existing.nodes);
      if (publicationErrors.length > 0) {
        return NextResponse.json({ error: publicationErrors.join('; '), errors: publicationErrors }, { status: 400 });
      }
      await assertAutomationGroupsEligible(prisma, body.nodes ?? existing.nodes);
      const revision = expectedRevision(body);
      if (!revision) {
        return NextResponse.json({ error: 'Refresh the workflow before publishing this version.' }, { status: 409 });
      }
      const published = await prisma.$transaction(async (tx) => {
        const sealed = await tx.workflowGraph.updateMany({
          where: { id: existing.id, status: 'draft', updatedAt: revision },
          data: {
            nodes: (body.nodes ?? existing.nodes) as object,
            edges: (body.edges ?? existing.edges) as object,
            triggerKey: validation.triggerKey!,
            status: 'published',
            enabled: false,
            updatedBy: admin.username,
          },
        });
        if (sealed.count !== 1) throw new Error('WORKFLOW_DRAFT_CHANGED');
        const published = await tx.workflowGraph.findUnique({ where: { id: existing.id } });
        if (!published) throw new Error('WORKFLOW_NOT_FOUND_AFTER_PUBLISH');
        await audit(request, admin.username, 'publish_workflow_graph', published.id, published.name, tx, true);
        return published;
      }, { isolationLevel: 'Serializable' });
      return NextResponse.json({ graph: published });
    }

    // Plain draft save.
    if (existing.status !== 'draft') {
      return NextResponse.json(
        { error: 'Published workflow versions are immutable. Create a draft to make changes.' },
        { status: 409 }
      );
    }
    const nodes = body.nodes ?? existing.nodes;
    const edges = body.edges ?? existing.edges;
    const validation = validateGraph(nodes, edges);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.errors.join('; '), errors: validation.errors }, { status: 400 });
    }
    const description =
      typeof body.description === 'string' && body.description.trim()
        ? body.description.trim().slice(0, DESCRIPTION_MAX)
        : existing.description;

    const revision = expectedRevision(body);
    if (!revision) {
      return NextResponse.json({ error: 'Refresh the workflow before saving this draft.' }, { status: 409 });
    }
    const saved = await prisma.workflowGraph.updateMany({
      where: { id: existing.id, status: 'draft', updatedAt: revision },
      data: {
        nodes: nodes as object,
        edges: edges as object,
        description,
        triggerKey: validation.triggerKey!,
        updatedBy: admin.username,
      },
    });
    if (saved.count !== 1) {
      return NextResponse.json(
        { error: 'This draft changed in another session. Refresh it before saving.' },
        { status: 409 }
      );
    }
    const updated = await prisma.workflowGraph.findUnique({ where: { id: existing.id } });
    if (!updated) {
      return NextResponse.json({ error: 'Workflow not found after saving' }, { status: 404 });
    }

    await audit(request, admin.username, 'save_workflow_graph', updated.id, updated.name);
    return NextResponse.json({ graph: updated });
  } catch (error) {
    if (error instanceof Error && error.message === 'WORKFLOW_ACTIVE_VERSION_CHANGED') {
      return NextResponse.json(
        { error: 'The active workflow version changed in another session. Refresh before replacing it.' },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message === 'WORKFLOW_DRAFT_CHANGED') {
      return NextResponse.json(
        { error: 'This draft changed in another session. Refresh it before publishing.' },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message === 'WORKFLOW_NOT_FOUND_AFTER_PUBLISH') {
      return NextResponse.json({ error: 'Workflow not found after publishing' }, { status: 404 });
    }
    const errorCode = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
    if (errorCode === 'P2002' || errorCode === 'P2034') {
      return NextResponse.json(
        { error: 'The workflow changed concurrently. Refresh before trying again.' },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message.startsWith('WORKFLOW_MONITOR_LIMIT:')) {
      return NextResponse.json(
        { error: `Activating this workflow would exceed the 100-check limit. ${error.message.split(':')[1]} slots remain.` },
        { status: 409 }
      );
    }
    if (error instanceof Error && error.message.startsWith('WORKFLOW_MONITOR_INVALID:')) {
      return NextResponse.json({ error: error.message.slice('WORKFLOW_MONITOR_INVALID:'.length) }, { status: 400 });
    }
    if (error instanceof Error && error.message.startsWith('WORKFLOW_MONITOR_LEGACY_MISMATCH:')) {
      return NextResponse.json({
        error: 'A legacy monitoring target changed after import. Re-import it before activating the replacement.',
      }, { status: 409 });
    }
    if (error instanceof Error && error.message.startsWith('WORKFLOW_GROUP_INELIGIBLE:')) {
      return NextResponse.json({
        error: `These groups are not active auto-approved join targets: ${error.message.slice('WORKFLOW_GROUP_INELIGIBLE:'.length)}`,
      }, { status: 400 });
    }
    console.error('Error updating workflow graph:', error);
    return NextResponse.json({ error: 'Failed to update workflow graph' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'automation.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const existing = await prisma.workflowGraph.findUnique({
      where: { id: (await params).id },
      include: { _count: { select: { runs: true } } },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    }
    if (isSeededWorkflowExample(existing.id)) {
      return NextResponse.json(
        { error: 'Seeded example workflows are read-only. Clone this example to create a disabled draft.' },
        { status: 409 }
      );
    }
    if (existing.status === 'published') {
      return NextResponse.json(
        {
          error: 'Published workflow versions are immutable. Disable new runs instead of deleting history.',
        },
        { status: 409 }
      );
    }
    if (existing._count.runs > 0) {
      // Non-published rows with run history may come from an older deployment.
      // Preserve reconstructability without changing node or edge definitions.
      await prisma.workflowGraph.update({
        where: { id: existing.id },
        data: { enabled: false, status: 'disabled', updatedBy: admin.username },
      });
      await audit(request, admin.username, 'retire_workflow_graph', existing.id, existing.name);
      return NextResponse.json({ retired: true });
    }
    await prisma.workflowGraph.delete({ where: { id: existing.id } });
    await audit(request, admin.username, 'delete_workflow_graph', existing.id, existing.name);
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error('Error deleting workflow graph:', error);
    return NextResponse.json({ error: 'Failed to delete workflow graph' }, { status: 500 });
  }
}

async function audit(
  request: NextRequest,
  username: string,
  action: string,
  targetId: string,
  name: string,
  database?: Pick<Prisma.TransactionClient, 'auditLog'>,
  strict = false
): Promise<void> {
  const entry: AuditLogEntry = {
    action,
    category: AuditCategories.SETTINGS,
    username,
    targetId,
    targetType: 'WorkflowGraph',
    eventKind: 'write',
    outcome: 'success',
    details: { name },
    ipAddress: getIpAddress(request),
    userAgent: getUserAgent(request),
  };
  const write = database ? logAuditAction(entry, database) : logAuditAction(entry);
  if (strict) {
    await write;
  } else {
    await write.catch(() => undefined);
  }
}
