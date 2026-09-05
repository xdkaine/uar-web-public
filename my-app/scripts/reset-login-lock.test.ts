import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';

interface RecoveryMetadata {
  operator: string;
  approver: string;
  ticket: string;
  settingsId: string;
  expectedUpdatedAt: Date;
  action: 'unlock' | 'restore';
}

interface RecoveryModule {
  requiredMetadata(environment: Record<string, string | undefined>): RecoveryMetadata;
  clearManualOverride(prisma: unknown, metadata: RecoveryMetadata): Promise<{
    changed: boolean;
    settings: { loginDisabled: boolean; manualOverride: boolean };
  }>;
}

const require = createRequire(import.meta.url);
const { clearManualOverride, requiredMetadata } = require('./reset-login-lock.js') as RecoveryModule;

describe('manual login lock recovery', () => {
  it('requires distinct operator and approver attribution', () => {
    expect(() => requiredMetadata({
      LOGIN_LOCK_RECOVERY_OPERATOR: 'alice',
      LOGIN_LOCK_RECOVERY_APPROVER: 'alice',
      LOGIN_LOCK_RECOVERY_TICKET: 'SEC-123',
      LOGIN_LOCK_RECOVERY_SETTINGS_ID: 'settings-1',
      LOGIN_LOCK_RECOVERY_EXPECTED_UPDATED_AT: '2026-08-02T20:00:00.000Z',
      LOGIN_LOCK_RECOVERY_ACTION: 'unlock',
    })).toThrow('must be different people');
  });

  it('clears only the override while preserving the login lock and writing an audit record', async () => {
    const transaction = {
      systemSettings: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn()
          .mockResolvedValueOnce({
            id: 'settings-1',
            loginDisabled: true,
            manualOverride: true,
          })
          .mockResolvedValueOnce({
            id: 'settings-1',
            loginDisabled: true,
            manualOverride: false,
          }),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };

    const result = await clearManualOverride(prisma, {
      operator: 'alice',
      approver: 'bob',
      ticket: 'SEC-123',
      settingsId: 'settings-1',
      expectedUpdatedAt: new Date('2026-08-02T20:00:00.000Z'),
      action: 'unlock',
    });

    expect(transaction.systemSettings.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'settings-1',
        updatedAt: new Date('2026-08-02T20:00:00.000Z'),
        manualOverride: true,
        loginDisabled: true,
      },
      data: {
        manualOverride: false,
        loginDisabled: true,
        lastModifiedBy: 'break-glass:alice:SEC-123',
      },
    });
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
    expect(result.settings).toMatchObject({ loginDisabled: true, manualOverride: false });
  });

  it('fails closed when the lock state changes concurrently', async () => {
    const transaction = {
      systemSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'settings-1',
          loginDisabled: true,
          manualOverride: true,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
      auditLog: { create: vi.fn() },
    };
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };

    await expect(clearManualOverride(prisma, {
      operator: 'alice',
      approver: 'bob',
      ticket: 'SEC-123',
      settingsId: 'settings-1',
      expectedUpdatedAt: new Date('2026-08-02T20:00:00.000Z'),
      action: 'unlock',
    })).rejects.toThrow('changed concurrently');
    expect(transaction.auditLog.create).not.toHaveBeenCalled();
  });

  it('restores both lock fields through the same audited transaction', async () => {
    const transaction = {
      systemSettings: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'settings-1',
          loginDisabled: true,
          manualOverride: false,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: vi.fn(),
      },
      auditLog: { create: vi.fn().mockResolvedValue({ id: 'audit-2' }) },
    };
    transaction.systemSettings.findUnique
      .mockResolvedValueOnce({ id: 'settings-1', loginDisabled: true, manualOverride: false })
      .mockResolvedValueOnce({ id: 'settings-1', loginDisabled: true, manualOverride: true });
    const prisma = {
      $transaction: vi.fn((callback: (value: typeof transaction) => unknown) => callback(transaction)),
    };

    const result = await clearManualOverride(prisma, {
      operator: 'alice',
      approver: 'bob',
      ticket: 'SEC-123',
      settingsId: 'settings-1',
      expectedUpdatedAt: new Date('2026-08-02T20:00:00.000Z'),
      action: 'restore',
    });

    expect(transaction.systemSettings.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'settings-1',
        updatedAt: new Date('2026-08-02T20:00:00.000Z'),
      },
      data: {
        manualOverride: true,
        loginDisabled: true,
        lastModifiedBy: 'break-glass:alice:SEC-123',
      },
    });
    expect(result.settings.manualOverride).toBe(true);
    expect(transaction.auditLog.create).toHaveBeenCalledOnce();
  });
});
