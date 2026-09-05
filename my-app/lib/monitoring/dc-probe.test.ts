import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createLDAPClient: vi.fn(),
  emitAutomationEvent: vi.fn(),
  serviceAlertFindFirst: vi.fn(),
  getConfigValue: vi.fn(),
  getRequiredSecretValue: vi.fn(),
}));

vi.mock('ldapts', () => ({
  Client: class {
    bind = vi.fn();
    search = vi.fn();
    unbind = vi.fn();
  },
}));

vi.mock('@/lib/ldap/client', () => ({
  createLDAPClient: mocks.createLDAPClient,
}));

vi.mock('@/lib/config/resolver', () => ({
  getConfigValue: mocks.getConfigValue,
  getRequiredSecretValue: mocks.getRequiredSecretValue,
}));

function defaultConfigValue(key: string): string {
  return (
    key === 'ldap.url'
      ? 'ldaps://dc1.example.org:636'
      : key === 'ldap.bindDn'
        ? 'CN=svc,DC=x'
        : ''
  );
}

vi.mock('@/lib/automation/emit', () => ({
  emitAutomationEvent: mocks.emitAutomationEvent,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    serviceAlert: { findFirst: mocks.serviceAlertFindFirst },
  },
}));

vi.mock('@/lib/logger', () => ({
  appLogger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

import { runDirectoryHealthCycle } from './dc-probe';

describe('runDirectoryHealthCycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.emitAutomationEvent.mockImplementation(
      async (triggerKey: string, eventKey: string) => ({
        triggerKey,
        eventKey,
        rulesConsidered: 0,
        summaries: [],
      })
    );
    mocks.serviceAlertFindFirst.mockResolvedValue(null);
    mocks.getConfigValue.mockImplementation(async (key: string) => defaultConfigValue(key));
    mocks.getRequiredSecretValue.mockResolvedValue('secret');
  });

  it('emits dc_unreachable with a bucketed event key when the probe fails', async () => {
    const client = {
      bind: vi.fn().mockRejectedValue(new Error('connect timeout')),
      search: vi.fn(),
      unbind: vi.fn(),
    };
    mocks.createLDAPClient.mockResolvedValue(client);

    const result = await runDirectoryHealthCycle();

    expect(result.probe.reachable).toBe(false);
    expect(result.emitted?.triggerKey).toBe('dc_unreachable');
    expect(result.emitted?.eventKey).toMatch(/^dc_unreachable:\d+$/);
    expect(mocks.emitAutomationEvent).toHaveBeenCalledWith(
      'dc_unreachable',
      expect.any(String),
      expect.objectContaining({ target: 'ldaps://dc1.example.org:636' })
    );
  });

  it('emits nothing when healthy and no directory alerts are active', async () => {
    const client = {
      bind: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue({ searchEntries: [] }),
      unbind: vi.fn().mockResolvedValue(undefined),
    };
    mocks.createLDAPClient.mockResolvedValue(client);

    const result = await runDirectoryHealthCycle();

    expect(result.probe.reachable).toBe(true);
    expect(result.emitted).toBeNull();
    expect(mocks.emitAutomationEvent).not.toHaveBeenCalled();
  });

  it('emits recovery only when an active directory alert exists', async () => {
    const client = {
      bind: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue({ searchEntries: [] }),
      unbind: vi.fn().mockResolvedValue(undefined),
    };
    mocks.createLDAPClient.mockResolvedValue(client);
    mocks.serviceAlertFindFirst.mockResolvedValue({ id: 'alert-1' });

    const result = await runDirectoryHealthCycle();

    expect(result.emitted?.triggerKey).toBe('dc_recovered');
    expect(mocks.emitAutomationEvent).toHaveBeenCalledWith(
      'dc_recovered',
      expect.stringMatching(/^dc_recovered:/),
      expect.objectContaining({ probeSource: 'dc_probe' })
    );
  });

  it('starts all directory configuration reads before waiting for any of them', async () => {
    let resolveTarget!: (value: string) => void;
    let resolveBindDn!: (value: string) => void;
    let resolveBindPassword!: (value: string) => void;
    mocks.getConfigValue.mockImplementation((key: string) => new Promise<string>((resolve) => {
      if (key === 'ldap.url') resolveTarget = resolve;
      else resolveBindDn = resolve;
    }));
    mocks.getRequiredSecretValue.mockImplementation(() => new Promise<string>((resolve) => {
      resolveBindPassword = resolve;
    }));
    mocks.createLDAPClient.mockResolvedValue({
      bind: vi.fn().mockResolvedValue(undefined),
      search: vi.fn().mockResolvedValue({ searchEntries: [] }),
      unbind: vi.fn().mockResolvedValue(undefined),
    });

    const pending = runDirectoryHealthCycle();
    await vi.waitFor(() => {
      expect(mocks.getConfigValue).toHaveBeenCalledTimes(2);
      expect(mocks.getRequiredSecretValue).toHaveBeenCalledTimes(1);
    });

    resolveTarget('ldaps://dc1.example.org:636');
    resolveBindDn('CN=svc,DC=x');
    resolveBindPassword('secret');

    await expect(pending).resolves.toMatchObject({ probe: { reachable: true } });
  });
});
