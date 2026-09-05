import type { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';

import { activateWorkflowMonitorChecks } from './workflow-state';

const importedCheck = {
  key: 'legacy_portal',
  name: 'Portal',
  kind: 'https',
  host: 'portal.internal.example',
  port: 443,
  path: '/health',
  method: 'GET',
  expectedStatusMin: 200,
  expectedStatusMax: 499,
  intervalSeconds: 60,
  timeoutMs: 5000,
  failureThreshold: 2,
  recoveryThreshold: 2,
  enabled: true,
  legacyEndpointId: 'legacy-target-1',
};

function transaction(legacyOverrides: Record<string, unknown> = {}) {
  const monitoredEndpointUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const tx = {
    workflowMonitorCheck: {
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue(null),
      upsert: vi.fn().mockResolvedValue({ id: 'check-1' }),
    },
    monitoredEndpoint: {
      findMany: vi.fn().mockResolvedValue([{
        id: 'legacy-target-1',
        protocol: 'https',
        host: 'portal.internal.example',
        port: 443,
        path: '/health',
        timeoutMs: 5000,
        failureThreshold: 2,
        recoveryThreshold: 2,
        ...legacyOverrides,
      }]),
      updateMany: monitoredEndpointUpdateMany,
    },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, monitoredEndpointUpdateMany };
}

describe('workflow monitor legacy replacement', () => {
  it('activates the imported check and disables the matching legacy target atomically', async () => {
    const { tx, monitoredEndpointUpdateMany } = transaction();

    await expect(activateWorkflowMonitorChecks(tx, {
      id: 'graph-2',
      name: 'Portal monitoring',
      nodes: [{ id: 'monitor-source', type: 'source_monitor_endpoints', config: { checks: [importedCheck] } }],
    }, 'automation-admin')).resolves.toBe(1);

    expect(monitoredEndpointUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['legacy-target-1'] }, enabled: true },
      data: { enabled: false, configVersion: { increment: 1 }, updatedBy: 'automation-admin' },
    });
  });

  it('rejects activation when the legacy target changed after import', async () => {
    const { tx, monitoredEndpointUpdateMany } = transaction({ port: 8443 });

    await expect(activateWorkflowMonitorChecks(tx, {
      id: 'graph-2',
      name: 'Portal monitoring',
      nodes: [{ id: 'monitor-source', type: 'source_monitor_endpoints', config: { checks: [importedCheck] } }],
    }, 'automation-admin')).rejects.toThrow('WORKFLOW_MONITOR_LEGACY_MISMATCH:legacy-target-1');
    expect(monitoredEndpointUpdateMany).not.toHaveBeenCalled();
  });
});
