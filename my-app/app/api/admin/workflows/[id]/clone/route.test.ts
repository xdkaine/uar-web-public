import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  permission: vi.fn(),
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  create: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAdminAuthWithRateLimit: mocks.auth }));
vi.mock('@/lib/rbac/core', () => ({ actorHasPermission: mocks.permission }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    workflowGraph: { findUnique: mocks.findUnique },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/audit-log', () => ({
  logAuditAction: mocks.audit,
  AuditCategories: { SETTINGS: 'settings' },
  getIpAddress: () => '203.0.113.20',
  getUserAgent: () => 'workflow-clone-route-test',
}));

import { POST } from './route';

const context = { params: Promise.resolve({ id: 'flowseed_outage02' }) };
const source = {
  id: 'flowseed_outage02', name: 'Directory outage escalation', description: 'Example only',
  triggerKey: 'dc_unreachable', nodes: [{ id: 'trigger', type: 'trigger_dc_unreachable', config: {} }], edges: [],
  status: 'draft', version: 1, enabled: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ admin: { username: 'automation-admin' }, response: null });
  mocks.permission.mockReturnValue(true);
  mocks.findUnique.mockResolvedValue(source);
  mocks.create.mockResolvedValue({ ...source, id: 'copied-draft', name: 'Directory outage escalation (example copy generated-id)' });
  mocks.transaction.mockImplementation((callback) => callback({ workflowGraph: { create: mocks.create } }));
  mocks.audit.mockResolvedValue(undefined);
});

describe('seeded workflow example clone route', () => {
  it('requires authentication and automation.manage', async () => {
    mocks.auth.mockResolvedValue({ admin: null, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) });
    expect((await POST(new NextRequest('https://portal.example.test/api/admin/workflows/flowseed_outage02/clone', { method: 'POST' }), context)).status).toBe(401);
    mocks.auth.mockResolvedValue({ admin: { username: 'automation-admin' }, response: null });
    mocks.permission.mockReturnValue(false);
    expect((await POST(new NextRequest('https://portal.example.test/api/admin/workflows/flowseed_outage02/clone', { method: 'POST' }), context)).status).toBe(403);
    expect(mocks.findUnique).not.toHaveBeenCalled();
  });

  it('creates an audited disabled draft without changing the seeded example', async () => {
    const response = await POST(new NextRequest('https://portal.example.test/api/admin/workflows/flowseed_outage02/clone', { method: 'POST' }), context);

    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      name: expect.stringMatching(/^Directory outage escalation \(example copy /), status: 'draft', enabled: false,
      createdBy: 'automation-admin', updatedBy: 'automation-admin', version: 1,
    }) });
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'clone_seeded_workflow_example', targetId: 'copied-draft',
    }), expect.any(Object));
  });

  it('rejects cloning a non-example graph', async () => {
    mocks.findUnique.mockResolvedValue({ ...source, id: 'operator-graph' });
    const response = await POST(new NextRequest('https://portal.example.test/api/admin/workflows/operator-graph/clone', { method: 'POST' }), { params: Promise.resolve({ id: 'operator-graph' }) });
    expect(response.status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
