import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  cronCount: vi.fn(),
  cronFindMany: vi.fn(),
  cronFindFirst: vi.fn(),
  cronGroupBy: vi.fn(),
  flowFindMany: vi.fn(),
  signalFindMany: vi.fn(),
  eventFindMany: vi.fn(),
}));

vi.mock('@/lib/adminAuth', () => ({ checkAuditAccessWithRateLimit: mocks.auth }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    cronRun: {
      count: mocks.cronCount,
      findMany: mocks.cronFindMany,
      findFirst: mocks.cronFindFirst,
      groupBy: mocks.cronGroupBy,
    },
    flowRun: { findMany: mocks.flowFindMany },
    operationalSignal: { findMany: mocks.signalFindMany },
    operationalSignalEvent: { findMany: mocks.eventFindMany },
  },
}));

import { GET } from './route';

describe('GET /api/admin/cron-runs safe audit projection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ admin: { username: 'audit-admin' }, response: null });
    mocks.cronCount.mockResolvedValue(0);
    mocks.cronFindMany.mockResolvedValue([]);
    mocks.cronFindFirst.mockResolvedValue(null);
    mocks.cronGroupBy.mockResolvedValue([]);
    mocks.signalFindMany.mockResolvedValue([]);
    mocks.eventFindMany.mockResolvedValue([]);
  });

  it('never returns raw workflow event keys or execution errors', async () => {
    mocks.flowFindMany.mockResolvedValue([{
      id: 'flow-run-1',
      status: 'failed',
      triggerKey: 'operational_issue_detected',
      eventKey: 'request:alice:secret-source-id',
      error: 'CN=Privileged Users,OU=Groups caused a failure',
      startedAt: new Date('2026-08-28T12:00:00.000Z'),
      finishedAt: new Date('2026-08-28T12:00:01.000Z'),
      graph: { id: 'graph-1', name: 'Notify operators', version: 2 },
    }]);

    const response = await GET(new NextRequest('http://localhost/api/admin/cron-runs'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.flowRuns[0]).toMatchObject({
      id: 'flow-run-1',
      triggerKey: 'operational_issue_detected',
      failureClass: 'workflow_execution_failed',
    });
    expect(JSON.stringify(body.flowRuns)).not.toContain('alice');
    expect(JSON.stringify(body.flowRuns)).not.toContain('Privileged Users');
    expect(mocks.flowFindMany.mock.calls[0][0].select).not.toHaveProperty('eventKey');
    expect(mocks.flowFindMany.mock.calls[0][0].select).not.toHaveProperty('error');
  });
});
