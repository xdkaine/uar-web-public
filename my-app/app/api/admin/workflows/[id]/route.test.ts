import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  checkAdminAuthWithRateLimit: vi.fn(),
  actorHasPermission: vi.fn(),
  validateGraph: vi.fn(),
  workflowGraphFindUnique: vi.fn(),
  workflowGraphFindFirst: vi.fn(),
  workflowGraphUpdate: vi.fn(),
  workflowGraphUpdateMany: vi.fn(),
  workflowGraphDelete: vi.fn(),
  transaction: vi.fn(),
  txWorkflowGraphUpdateMany: vi.fn(),
  txWorkflowGraphUpdate: vi.fn(),
  txWorkflowGraphFindFirst: vi.fn(),
  txWorkflowGraphCreate: vi.fn(),
  txWorkflowGraphFindUnique: vi.fn(),
  txWorkflowMonitorCheckUpdateMany: vi.fn(),
  logAuditAction: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({
  checkAdminAuthWithRateLimit: mocks.checkAdminAuthWithRateLimit,
}));

vi.mock('@/lib/rbac/core', () => ({
  actorHasPermission: mocks.actorHasPermission,
}));

vi.mock('@/lib/flow/graph', () => ({
  validateGraph: mocks.validateGraph,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    workflowGraph: {
      findUnique: mocks.workflowGraphFindUnique,
      findFirst: mocks.workflowGraphFindFirst,
      update: mocks.workflowGraphUpdate,
      updateMany: mocks.workflowGraphUpdateMany,
      delete: mocks.workflowGraphDelete,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.logAuditAction,
  AuditCategories: { SETTINGS: 'settings' },
  getIpAddress: () => '203.0.113.20',
  getUserAgent: () => 'workflow-id-route-test',
}));

import { DELETE, GET, PATCH } from './route';

const ROUTE_CONTEXT = { params: Promise.resolve({ id: 'graph-1' }) };

function graph(overrides: Record<string, unknown> = {}) {
  return {
    id: 'graph-1',
    name: 'Onboarding flow',
    description: null,
    triggerKey: 'request.submitted',
    nodes: [{ id: 'start', type: 'trigger', config: {} }],
    edges: [],
    status: 'draft',
    version: 1,
    enabled: false,
    createdBy: 'automation-admin',
    updatedBy: 'automation-admin',
    updatedAt: new Date('2026-08-27T12:00:00.000Z'),
    ...overrides,
  };
}

function patch(body: Record<string, unknown>) {
  return new NextRequest('https://portal.example.test/api/admin/workflows/graph-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expectedUpdatedAt: '2026-08-27T12:00:00.000Z', ...body }),
  });
}

function expectLastAudit(action: string, targetId = 'graph-1') {
  expect(mocks.logAuditAction.mock.calls.at(-1)?.[0]).toEqual(expect.objectContaining({
    action,
    username: 'automation-admin',
    targetType: 'WorkflowGraph',
    targetId,
  }));
}

describe('workflow graph detail route authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'automation-admin' },
      response: null,
    });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.workflowGraphFindUnique.mockResolvedValue(graph());
    mocks.validateGraph.mockReturnValue({ ok: true, triggerKey: 'request.submitted' });
    mocks.transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          workflowGraph: {
            updateMany: mocks.txWorkflowGraphUpdateMany,
            update: mocks.txWorkflowGraphUpdate,
            findFirst: mocks.txWorkflowGraphFindFirst,
            create: mocks.txWorkflowGraphCreate,
            findUnique: mocks.txWorkflowGraphFindUnique,
          },
          workflowMonitorCheck: {
            updateMany: mocks.txWorkflowMonitorCheckUpdateMany,
          },
        })
    );
    mocks.txWorkflowGraphUpdateMany.mockResolvedValue({ count: 1 });
    mocks.txWorkflowMonitorCheckUpdateMany.mockResolvedValue({ count: 0 });
    mocks.txWorkflowGraphUpdate.mockResolvedValue(graph({ status: 'published', enabled: true }));
    mocks.workflowGraphUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      graph({ ...data })
    );
    mocks.workflowGraphUpdateMany.mockResolvedValue({ count: 1 });
    mocks.workflowGraphDelete.mockResolvedValue(graph());
    mocks.logAuditAction.mockResolvedValue(undefined);
  });

  it('rejects unauthenticated callers with 401 before any lookup', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: null,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const getResponse = await GET(
      new NextRequest('https://portal.example.test/api/admin/workflows/graph-1'),
      ROUTE_CONTEXT
    );

    expect(getResponse.status).toBe(401);
    expect(mocks.workflowGraphFindUnique).not.toHaveBeenCalled();
  });

  it.each([
    [
      'GET',
      () =>
        GET(new NextRequest('https://portal.example.test/api/admin/workflows/graph-1'), ROUTE_CONTEXT),
    ],
    ['PATCH', () => PATCH(patch({ action: 'save' }), ROUTE_CONTEXT)],
    ['DELETE', () => DELETE(new NextRequest('https://portal.example.test/api/admin/workflows/graph-1', { method: 'DELETE' }), ROUTE_CONTEXT)],
  ])('rejects %s without automation.manage with 403', async (_method, invoke) => {
    mocks.actorHasPermission.mockReturnValue(false);

    const response = await invoke();

    expect(response.status).toBe(403);
    expect(mocks.workflowGraphFindUnique).not.toHaveBeenCalled();
    expect(mocks.workflowGraphDelete).not.toHaveBeenCalled();
  });
});

describe('workflow graph detail GET', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'automation-admin' },
      response: null,
    });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.logAuditAction.mockResolvedValue(undefined);
  });

  it('returns the graph with its recent runs', async () => {
    const stored = graph({ runs: [{ id: 'run-1', status: 'succeeded' }] });
    mocks.workflowGraphFindUnique.mockResolvedValue(stored);

    const response = await GET(
      new NextRequest('https://portal.example.test/api/admin/workflows/graph-1'),
      ROUTE_CONTEXT
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.graph).toMatchObject({ id: 'graph-1', runs: [{ id: 'run-1' }] });
    expect(mocks.workflowGraphFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'graph-1' },
        include: expect.objectContaining({ runs: expect.objectContaining({ take: 20 }) }),
      })
    );
  });

  it('returns 404 for an unknown graph', async () => {
    mocks.workflowGraphFindUnique.mockResolvedValue(null);

    const response = await GET(
      new NextRequest('https://portal.example.test/api/admin/workflows/missing'),
      { params: Promise.resolve({ id: 'missing' }) }
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Workflow not found' });
  });
});

describe('workflow graph draft saves', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'automation-admin' },
      response: null,
    });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.workflowGraphFindUnique.mockResolvedValue(graph());
    mocks.validateGraph.mockReturnValue({ ok: true, triggerKey: 'request.submitted' });
    mocks.workflowGraphUpdate.mockImplementation(async ({ data }: { data: Record<string, unknown> }) =>
      graph({ ...data })
    );
    mocks.logAuditAction.mockResolvedValue(undefined);
  });

  it('persists validated draft edits and stamps the trigger key', async () => {
    const nodes = [{ id: 'start', type: 'trigger', config: {} }];
    const response = await PATCH(
      patch({ nodes, edges: [], description: '  Updated copy  ' }),
      ROUTE_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(mocks.workflowGraphUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'graph-1',
        status: 'draft',
        updatedAt: new Date('2026-08-27T12:00:00.000Z'),
      },
      data: expect.objectContaining({
        nodes,
        edges: [],
        description: 'Updated copy',
        triggerKey: 'request.submitted',
        updatedBy: 'automation-admin',
      }),
    });
    expectLastAudit('save_workflow_graph');
  });

  it('surfaces validation errors and keeps the stored graph untouched', async () => {
    mocks.validateGraph.mockReturnValue({
      ok: false,
      errors: ['A workflow needs at least one trigger node'],
    });

    const response = await PATCH(patch({ nodes: [], edges: [] }), ROUTE_CONTEXT);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('A workflow needs at least one trigger node');
    expect(body.errors).toEqual(['A workflow needs at least one trigger node']);
    expect(mocks.workflowGraphUpdateMany).not.toHaveBeenCalled();
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
  });

  it('keeps the existing description when the save omits or blanks it', async () => {
    mocks.workflowGraphFindUnique.mockResolvedValue(graph({ description: 'Keep me' }));

    await PATCH(patch({ nodes: [], edges: [] }), ROUTE_CONTEXT);
    await PATCH(patch({ nodes: [], edges: [], description: '   ' }), ROUTE_CONTEXT);

    expect(mocks.workflowGraphUpdateMany).toHaveBeenCalledTimes(2);
    expect(mocks.workflowGraphUpdateMany.mock.calls[0][0].data.description).toBe('Keep me');
    expect(mocks.workflowGraphUpdateMany.mock.calls[1][0].data.description).toBe('Keep me');
  });

  it('returns 404 when saving an unknown graph', async () => {
    mocks.workflowGraphFindUnique.mockResolvedValue(null);

    const response = await PATCH(patch({ nodes: [], edges: [] }), ROUTE_CONTEXT);

    expect(response.status).toBe(404);
    expect(mocks.workflowGraphUpdateMany).not.toHaveBeenCalled();
  });
});

describe('workflow graph publish transitions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'automation-admin' },
      response: null,
    });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.validateGraph.mockReturnValue({ ok: true, triggerKey: 'request.submitted' });
    mocks.transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
        workflowGraph: {
          updateMany: mocks.txWorkflowGraphUpdateMany,
          update: mocks.txWorkflowGraphUpdate,
          findFirst: mocks.txWorkflowGraphFindFirst,
          create: mocks.txWorkflowGraphCreate,
          findUnique: mocks.txWorkflowGraphFindUnique,
        },
        })
    );
    mocks.txWorkflowGraphUpdateMany.mockResolvedValue({ count: 1 });
    mocks.txWorkflowGraphUpdate.mockResolvedValue(graph({ status: 'published', enabled: false }));
    mocks.txWorkflowGraphFindUnique.mockResolvedValue(graph({ status: 'published', enabled: false }));
    mocks.workflowGraphUpdateMany.mockResolvedValue({ count: 1 });
    mocks.logAuditAction.mockResolvedValue(undefined);
  });

  it('seals a draft as an immutable published version without activating it', async () => {
    mocks.workflowGraphFindUnique.mockResolvedValueOnce(graph());

    const response = await PATCH(patch({ action: 'publish' }), ROUTE_CONTEXT);

    expect(response.status).toBe(200);
    expect(mocks.txWorkflowGraphUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'graph-1',
        status: 'draft',
        updatedAt: new Date('2026-08-27T12:00:00.000Z'),
      },
      data: expect.objectContaining({
        status: 'published',
        enabled: false,
        triggerKey: 'request.submitted',
      }),
    });
    expectLastAudit('publish_workflow_graph');
    expect(mocks.logAuditAction.mock.calls.at(-1)?.[1]).toBeDefined();
    expect(await response.json()).toMatchObject({ graph: { status: 'published', enabled: false } });
  });

  it('re-validates the graph shape before publishing and refuses invalid graphs', async () => {
    mocks.workflowGraphFindUnique.mockResolvedValue(graph());
    mocks.validateGraph.mockReturnValue({ ok: false, errors: ['Edges must be a list'] });

    const response = await PATCH(patch({ action: 'publish' }), ROUTE_CONTEXT);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Edges must be a list' });
    expect(mocks.txWorkflowGraphUpdateMany).not.toHaveBeenCalled();
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
  });

  it('rejects publishing an already-published immutable version', async () => {
    const published = graph({ status: 'published', enabled: true });
    mocks.workflowGraphFindUnique.mockResolvedValue(published);

    const response = await PATCH(patch({ action: 'publish' }), ROUTE_CONTEXT);

    expect(response.status).toBe(409);
    expect(mocks.workflowGraphUpdateMany).not.toHaveBeenCalled();
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
  });

  it('rejects a seeded example before it can be published or changed', async () => {
    mocks.workflowGraphFindUnique.mockResolvedValue(graph({ id: 'flowseed_outage02' }));

    const response = await PATCH(patch({ action: 'publish' }), {
      params: Promise.resolve({ id: 'flowseed_outage02' }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('Seeded example workflows are read-only') });
    expect(mocks.workflowGraphUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects unsafe executable recipients before publishing', async () => {
    mocks.workflowGraphFindUnique.mockResolvedValue(graph({
      nodes: [
        { id: 'trigger', type: 'trigger_dc_unreachable', config: {} },
        { id: 'email', type: 'action_send_email', config: { to: 'ops@example.org', subject: 'Alert', body: 'Details' } },
      ],
    }));

    const response = await PATCH(patch({ action: 'publish' }), ROUTE_CONTEXT);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('reserved/example destination') });
    expect(mocks.workflowGraphUpdateMany).not.toHaveBeenCalled();
  });
});

describe('workflow graph disable', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'automation-admin' },
      response: null,
    });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.workflowGraphFindUnique
      .mockResolvedValueOnce(graph({ status: 'published', enabled: true }))
      .mockResolvedValueOnce(graph({ status: 'published', enabled: false }));
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<unknown>) => fn({
      workflowGraph: { updateMany: mocks.txWorkflowGraphUpdateMany },
      workflowMonitorCheck: { updateMany: mocks.txWorkflowMonitorCheckUpdateMany },
    }));
    mocks.txWorkflowGraphUpdateMany.mockResolvedValue({ count: 1 });
    mocks.txWorkflowMonitorCheckUpdateMany.mockResolvedValue({ count: 0 });
    mocks.logAuditAction.mockResolvedValue(undefined);
  });

  it('disables without changing publication status', async () => {
    const response = await PATCH(patch({ action: 'disable' }), ROUTE_CONTEXT);

    expect(response.status).toBe(200);
    expect(mocks.txWorkflowGraphUpdateMany).toHaveBeenCalledWith({
      where: {
        id: 'graph-1',
        status: 'published',
        enabled: true,
        updatedAt: new Date('2026-08-27T12:00:00.000Z'),
      },
      data: { enabled: false, updatedBy: 'automation-admin' },
    });
    expectLastAudit('disable_workflow_graph');
    expect(await response.json()).toMatchObject({ graph: { enabled: false, status: 'published' } });
  });
});

describe('workflow graph version activation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'automation-admin' },
      response: null,
    });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.transaction.mockImplementation(
      async (fn: (tx: unknown) => Promise<unknown>) => fn({
        workflowGraph: {
          findFirst: mocks.txWorkflowGraphFindFirst,
          create: mocks.txWorkflowGraphCreate,
          updateMany: mocks.txWorkflowGraphUpdateMany,
          update: mocks.txWorkflowGraphUpdate,
          findUnique: mocks.txWorkflowGraphFindUnique,
        },
        workflowMonitorCheck: { updateMany: mocks.txWorkflowMonitorCheckUpdateMany },
      })
    );
    mocks.logAuditAction.mockResolvedValue(undefined);
    mocks.txWorkflowMonitorCheckUpdateMany.mockResolvedValue({ count: 0 });
  });

  it('creates version N+1 as a disabled draft without mutating the published source', async () => {
    mocks.workflowGraphFindUnique.mockResolvedValue(graph({ status: 'published', enabled: true, version: 3 }));
    mocks.txWorkflowGraphFindFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ version: 3 });
    mocks.txWorkflowGraphCreate.mockResolvedValue(graph({ id: 'draft-4', version: 4 }));

    const response = await PATCH(patch({ action: 'create_draft' }), ROUTE_CONTEXT);

    expect(response.status).toBe(201);
    expect(mocks.txWorkflowGraphCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: 'draft', version: 4, enabled: false }),
    });
    expect(mocks.workflowGraphUpdate).not.toHaveBeenCalled();
    expectLastAudit('create_workflow_draft', 'draft-4');
  });

  it('activates one published version while disabling active siblings atomically', async () => {
    mocks.workflowGraphFindUnique.mockResolvedValue(graph({ status: 'published', enabled: false, version: 4 }));
    mocks.txWorkflowGraphFindFirst.mockResolvedValue({ id: 'graph-3' });
    mocks.txWorkflowGraphUpdateMany.mockResolvedValue({ count: 1 });
    mocks.txWorkflowGraphFindUnique.mockResolvedValue(graph({ status: 'published', enabled: true, version: 4 }));

    const response = await PATCH(patch({ action: 'enable', expectedActiveGraphId: 'graph-3' }), ROUTE_CONTEXT);

    expect(response.status).toBe(200);
    expect(mocks.txWorkflowGraphUpdateMany).toHaveBeenNthCalledWith(1, {
      where: {
        name: 'Onboarding flow',
        status: 'published',
        enabled: true,
        id: { not: 'graph-1' },
      },
      data: { enabled: false, updatedBy: 'automation-admin' },
    });
    expect(mocks.txWorkflowGraphUpdateMany).toHaveBeenNthCalledWith(2, {
      where: {
        id: 'graph-1',
        status: 'published',
        enabled: false,
        updatedAt: new Date('2026-08-27T12:00:00.000Z'),
      },
      data: { enabled: true, updatedBy: 'automation-admin' },
    });
    expectLastAudit('enable_workflow_graph');
    expect(mocks.logAuditAction.mock.calls.at(-1)?.[1]).toBeDefined();
  });

  it('maps a serializable activation conflict to a refreshable 409', async () => {
    mocks.workflowGraphFindUnique.mockResolvedValue(graph({ status: 'published', enabled: false, version: 4 }));
    mocks.transaction.mockRejectedValueOnce(Object.assign(new Error('serialization conflict'), { code: 'P2034' }));

    const response = await PATCH(patch({ action: 'enable', expectedActiveGraphId: null }), ROUTE_CONTEXT);

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('changed concurrently') });
  });
});

describe('workflow graph deletion and retirement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'automation-admin' },
      response: null,
    });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.workflowGraphDelete.mockResolvedValue(graph());
    mocks.workflowGraphUpdate.mockResolvedValue(graph({ status: 'disabled', enabled: false }));
    mocks.logAuditAction.mockResolvedValue(undefined);
  });

  it('deletes an untouched draft outright', async () => {
    mocks.workflowGraphFindUnique.mockResolvedValue(graph({ _count: { runs: 0 } }));

    const response = await DELETE(
      new NextRequest('https://portal.example.test/api/admin/workflows/graph-1', { method: 'DELETE' }),
      ROUTE_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true });
    expect(mocks.workflowGraphDelete).toHaveBeenCalledWith({ where: { id: 'graph-1' } });
    expectLastAudit('delete_workflow_graph');
  });

  it('rejects deleting a published graph so history stays reconstructable', async () => {
    mocks.workflowGraphFindUnique.mockResolvedValue(
      graph({ status: 'published', enabled: true, _count: { runs: 0 } })
    );

    const response = await DELETE(
      new NextRequest('https://portal.example.test/api/admin/workflows/graph-1', { method: 'DELETE' }),
      ROUTE_CONTEXT
    );

    expect(response.status).toBe(409);
    expect(mocks.workflowGraphDelete).not.toHaveBeenCalled();
    expect(mocks.workflowGraphUpdate).not.toHaveBeenCalled();
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
  });

  it('retires instead of deleting any graph with run history', async () => {
    mocks.workflowGraphFindUnique.mockResolvedValue(graph({ _count: { runs: 3 } }));

    const response = await DELETE(
      new NextRequest('https://portal.example.test/api/admin/workflows/graph-1', { method: 'DELETE' }),
      ROUTE_CONTEXT
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ retired: true });
    expect(mocks.workflowGraphDelete).not.toHaveBeenCalled();
    expect(mocks.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'retire_workflow_graph' })
    );
  });

  it('returns 404 for an unknown graph', async () => {
    mocks.workflowGraphFindUnique.mockResolvedValue(null);

    const response = await DELETE(
      new NextRequest('https://portal.example.test/api/admin/workflows/graph-1', { method: 'DELETE' }),
      ROUTE_CONTEXT
    );

    expect(response.status).toBe(404);
    expect(mocks.workflowGraphDelete).not.toHaveBeenCalled();
    expect(mocks.workflowGraphUpdate).not.toHaveBeenCalled();
  });
});
