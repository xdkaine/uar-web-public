import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  checkAdminAuthWithRateLimit: vi.fn(),
  actorHasPermission: vi.fn(),
  validateGraph: vi.fn(),
  workflowGraphCount: vi.fn(),
  workflowGraphCreate: vi.fn(),
  workflowGraphFindMany: vi.fn(),
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

vi.mock('@/lib/flow/catalog', () => ({
  FLOW_NODE_CATALOG: {},
  TRIGGER_KEY_TO_NODE_TYPE: {},
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    workflowGraph: {
      count: mocks.workflowGraphCount,
      create: mocks.workflowGraphCreate,
      findMany: mocks.workflowGraphFindMany,
    },
  },
}));

vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.logAuditAction,
  AuditCategories: { SETTINGS: 'settings' },
  getIpAddress: () => '203.0.113.20',
  getUserAgent: () => 'workflows-route-test',
}));

import { GET, POST } from './route';

function post(body: string) {
  return new NextRequest('https://portal.example.test/api/admin/workflows', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

const VALID_BODY = JSON.stringify({
  name: 'Onboarding flow',
  nodes: [{ id: 'start', type: 'trigger' }],
  edges: [],
});

describe('workflow graph create route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'automation-admin' },
      response: null,
    });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.validateGraph.mockReturnValue({ ok: true, triggerKey: 'request.submitted' });
    mocks.workflowGraphCount.mockResolvedValue(0);
    mocks.workflowGraphCreate.mockResolvedValue({ id: 'graph-1', name: 'Onboarding flow' });
    mocks.workflowGraphFindMany.mockResolvedValue([]);
    mocks.logAuditAction.mockResolvedValue(undefined);
  });

  it('creates graphs within the request size cap', async () => {
    const response = await POST(post(VALID_BODY));

    expect(response.status).toBe(201);
    expect(mocks.workflowGraphCreate).toHaveBeenCalledTimes(1);
  });

  it('rejects oversized graph payloads with 413 without persisting', async () => {
    const oversized = JSON.stringify({
      name: 'Huge graph',
      description: 'x'.repeat(101 * 1024),
      nodes: [],
      edges: [],
    });

    const response = await POST(post(oversized));

    expect(response.status).toBe(413);
    expect(mocks.workflowGraphCreate).not.toHaveBeenCalled();
    expect(mocks.logAuditAction).not.toHaveBeenCalled();
  });

  it('rejects malformed JSON with 400', async () => {
    const response = await POST(post('{not-json'));

    expect(response.status).toBe(400);
    expect(mocks.workflowGraphCreate).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated callers with 401', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: null,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = await POST(post(VALID_BODY));

    expect(response.status).toBe(401);
    expect(mocks.actorHasPermission).not.toHaveBeenCalled();
    expect(mocks.workflowGraphCreate).not.toHaveBeenCalled();
  });

  it('rejects callers without automation.manage with 403', async () => {
    mocks.actorHasPermission.mockReturnValue(false);

    const response = await POST(post(VALID_BODY));

    expect(response.status).toBe(403);
    expect(mocks.validateGraph).not.toHaveBeenCalled();
    expect(mocks.workflowGraphCreate).not.toHaveBeenCalled();
  });

  it('surfaces graph validation errors without persisting', async () => {
    mocks.validateGraph.mockReturnValue({
      ok: false,
      errors: ['A workflow needs at least one trigger node', 'Unknown node type "nope"'],
    });

    const response = await POST(post(VALID_BODY));
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error).toBe('A workflow needs at least one trigger node; Unknown node type "nope"');
    expect(mocks.workflowGraphCount).not.toHaveBeenCalled();
    expect(mocks.workflowGraphCreate).not.toHaveBeenCalled();
  });

  it('conflicts when a graph with the same name already exists', async () => {
    mocks.workflowGraphCount.mockResolvedValue(1);

    const response = await POST(post(VALID_BODY));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: 'A workflow with this name already exists' });
    expect(mocks.workflowGraphCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['missing name', JSON.stringify({ nodes: [], edges: [] })],
    ['blank name', JSON.stringify({ name: '   ', nodes: [], edges: [] })],
    ['oversized name', JSON.stringify({ name: 'x'.repeat(121), nodes: [], edges: [] })],
  ])('rejects %s with 400', async (_label, body) => {
    const response = await POST(post(body));

    expect(response.status).toBe(400);
    expect(mocks.workflowGraphCreate).not.toHaveBeenCalled();
  });

  it('persists a disabled draft owned by the caller and audits the create', async () => {
    const response = await POST(
      post(
        JSON.stringify({
          name: 'Onboarding flow',
          description: '  Provisions accounts  ',
          nodes: [{ id: 'start', type: 'trigger' }],
          edges: [],
        })
      )
    );

    expect(response.status).toBe(201);
    expect(mocks.workflowGraphCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: 'Onboarding flow',
        description: 'Provisions accounts',
        triggerKey: 'request.submitted',
        status: 'draft',
        enabled: false,
        createdBy: 'automation-admin',
        updatedBy: 'automation-admin',
      }),
    });
    expect(mocks.logAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create_workflow_graph',
        username: 'automation-admin',
        targetId: 'graph-1',
        targetType: 'WorkflowGraph',
      })
    );
  });
});

describe('workflow graph list route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: { username: 'automation-admin' },
      response: null,
    });
    mocks.actorHasPermission.mockReturnValue(true);
    mocks.logAuditAction.mockResolvedValue(undefined);
  });

  it('lists graphs with run counts flattened and includes the node catalog', async () => {
    mocks.workflowGraphFindMany.mockResolvedValue([
      { id: 'graph-2', name: 'Alpha', version: 3, _count: { runs: 7 } },
      { id: 'graph-1', name: 'Beta', version: 1, _count: { runs: 0 } },
    ]);

    const response = await GET(new NextRequest('https://portal.example.test/api/admin/workflows'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.graphs).toEqual([
      { id: 'graph-2', name: 'Alpha', version: 3, runCount: 7 },
      { id: 'graph-1', name: 'Beta', version: 1, runCount: 0 },
    ]);
    expect(Array.isArray(body.catalog)).toBe(true);
    expect(mocks.workflowGraphFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ name: 'asc' }, { version: 'desc' }],
      })
    );
  });

  it('requires automation.manage to list graphs', async () => {
    mocks.actorHasPermission.mockReturnValue(false);

    const response = await GET(new NextRequest('https://portal.example.test/api/admin/workflows'));

    expect(response.status).toBe(403);
    expect(mocks.workflowGraphFindMany).not.toHaveBeenCalled();
  });

  it('rejects unauthenticated list requests with 401', async () => {
    mocks.checkAdminAuthWithRateLimit.mockResolvedValue({
      admin: null,
      response: Response.json({ error: 'Unauthorized' }, { status: 401 }),
    });

    const response = await GET(new NextRequest('https://portal.example.test/api/admin/workflows'));

    expect(response.status).toBe(401);
    expect(mocks.workflowGraphFindMany).not.toHaveBeenCalled();
  });
});
