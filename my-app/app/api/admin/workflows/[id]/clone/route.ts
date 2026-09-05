import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { isSeededWorkflowExample } from '@/lib/flow/publication-guard';
import { logAuditAction, getIpAddress, getUserAgent, AuditCategories } from '@/lib/audit-log';

export const dynamic = 'force-dynamic';

/**
 * Copies a migration-seeded example into an operator-owned, disabled draft.
 * The example remains immutable so its warning/example destinations can never
 * become executable merely through an overlooked UI control.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (!actorHasPermission(admin, 'automation.manage')) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  try {
    const source = await prisma.workflowGraph.findUnique({ where: { id: (await params).id } });
    if (!source) return NextResponse.json({ error: 'Workflow not found' }, { status: 404 });
    if (!isSeededWorkflowExample(source.id)) {
      return NextResponse.json({ error: 'Only seeded workflow examples can be cloned with this action.' }, { status: 409 });
    }

    // A unique clone family cannot collide with an unrelated workflow whose
    // human-readable name happens to include "(copy)".
    const name = `${source.name} (example copy ${randomUUID()})`;
    const result = await prisma.$transaction(async (tx) => {
      const graph = await tx.workflowGraph.create({
        data: {
          name,
          description: source.description,
          triggerKey: source.triggerKey,
          nodes: source.nodes as object,
          edges: source.edges as object,
          status: 'draft',
          version: 1,
          enabled: false,
          createdBy: admin.username,
          updatedBy: admin.username,
        },
      });
      await logAuditAction({
        action: 'clone_seeded_workflow_example',
        category: AuditCategories.SETTINGS,
        username: admin.username,
        targetId: graph.id,
        targetType: 'WorkflowGraph',
        eventKind: 'write',
        outcome: 'success',
        details: { sourceId: source.id, sourceName: source.name, name: graph.name, enabled: false },
        ipAddress: getIpAddress(request),
        userAgent: getUserAgent(request),
      }, tx);
      return graph;
    }, { isolationLevel: 'Serializable' });

    return NextResponse.json({ graph: result }, { status: 201 });
  } catch (error) {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
    if (code === 'P2002' || code === 'P2034') {
      return NextResponse.json({ error: 'The workflow list changed concurrently. Refresh and clone the example again.' }, { status: 409 });
    }
    console.error('Error cloning seeded workflow example:', error);
    return NextResponse.json({ error: 'Failed to clone workflow example' }, { status: 500 });
  }
}
