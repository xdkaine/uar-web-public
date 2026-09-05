import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkAdminAuthWithRateLimit } from '@/lib/adminAuth';
import { actorHasPermission } from '@/lib/rbac/core';
import { validateGraph } from '@/lib/flow/graph';
import { FLOW_NODE_CATALOG, TRIGGER_KEY_TO_NODE_TYPE } from '@/lib/flow/catalog';
import { logAuditAction, getIpAddress, getUserAgent, AuditCategories } from '@/lib/audit-log';
import { isJsonBodyError, MAX_REQUEST_BODY_SIZE, parseAdminJson } from '@/lib/admin-json-parser';

export const dynamic = 'force-dynamic';

const NAME_MAX = 120;
const DESCRIPTION_MAX = 500;

/** List every graph with run counts plus the node catalog for the canvas. */
export async function GET(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'automation.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const graphs = await prisma.workflowGraph.findMany({
    orderBy: [{ name: 'asc' }, { version: 'desc' }],
    include: { _count: { select: { runs: true } } },
  });

  return NextResponse.json({
    graphs: graphs.map(({ _count, ...graph }) => ({ ...graph, runCount: _count.runs })),
    catalog: Object.values(FLOW_NODE_CATALOG),
  });
}

interface CreateGraphBody {
  name?: unknown;
  description?: unknown;
  nodes?: unknown;
  edges?: unknown;
}

export async function POST(request: NextRequest) {
  const { admin, response } = await checkAdminAuthWithRateLimit(request);
  if (!admin || response) {
    return response || NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!actorHasPermission(admin, 'automation.manage')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  try {
    const body = await parseAdminJson<CreateGraphBody>(request, MAX_REQUEST_BODY_SIZE.MEDIUM);

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > NAME_MAX) {
      return NextResponse.json(
        { error: `Name is required and must be at most ${NAME_MAX} characters` },
        { status: 400 }
      );
    }
    const description =
      typeof body.description === 'string' && body.description.trim()
        ? body.description.trim().slice(0, DESCRIPTION_MAX)
        : null;

    const validation = validateGraph(body.nodes, body.edges);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.errors.join('; ') }, { status: 400 });
    }

    const existing = await prisma.workflowGraph.count({ where: { name } });
    if (existing > 0) {
      return NextResponse.json({ error: 'A workflow with this name already exists' }, { status: 409 });
    }

    const graph = await prisma.workflowGraph.create({
      data: {
        name,
        description,
        triggerKey: validation.triggerKey!,
        nodes: body.nodes as object,
        edges: body.edges as object,
        status: 'draft',
        enabled: false,
        createdBy: admin.username,
        updatedBy: admin.username,
      },
    });

    await logAuditAction({
      action: 'create_workflow_graph',
      category: AuditCategories.SETTINGS,
      username: admin.username,
      targetId: graph.id,
      targetType: 'WorkflowGraph',
      eventKind: 'write',
      outcome: 'success',
      details: { name, triggerKey: graph.triggerKey },
      ipAddress: getIpAddress(request),
      userAgent: getUserAgent(request),
    }).catch(() => undefined);

    void TRIGGER_KEY_TO_NODE_TYPE;
    return NextResponse.json({ graph }, { status: 201 });
  } catch (error) {
    if (isJsonBodyError(error)) {
      return NextResponse.json({ error: error.message }, { status: error.statusCode });
    }
    console.error('Error creating workflow graph:', error);
    return NextResponse.json({ error: 'Failed to create workflow graph' }, { status: 500 });
  }
}
