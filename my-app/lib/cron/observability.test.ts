import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  prisma: {
    cronRun: { create: vi.fn() },
  },
  appLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  isEnabled: vi.fn(),
  observeCronRun: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));
vi.mock('@/lib/logger', () => ({ appLogger: mocks.appLogger }));
vi.mock('@/lib/operations/detectors', () => ({ observeCronRun: mocks.observeCronRun }));

import {
  checkCronModuleEnabled,
  classifyCronError,
  runCronWithObservability,
} from './observability';

describe('classifyCronError', () => {
  it('classifies known failure domains', () => {
    expect(classifyCronError(new Error('LDAP connection refused'))).toBe('ldap_error');
    expect(classifyCronError(new Error('SMTP relay unavailable'))).toBe('smtp_error');
    expect(classifyCronError(new Error('request ETIMEDOUT'))).toBe('timeout');
    expect(classifyCronError(new Error('could not connect to upstream'))).toBe('connection_error');
  });

  it('falls back to error name then unknown', () => {
    const named = new Error('mystery');
    named.name = 'CustomError';
    expect(classifyCronError(named)).toBe('CustomError');
    expect(classifyCronError(new Error('mystery'))).toBe('Error');
    expect(classifyCronError('not an error object')).toBe('unknown_error');
  });
});

describe('runCronWithObservability', () => {
  beforeEach(() => {
    mocks.prisma.cronRun.create.mockReset();
    mocks.observeCronRun.mockReset();
    mocks.observeCronRun.mockResolvedValue(undefined);
    mocks.prisma.cronRun.create.mockImplementation(async ({ data }) => ({ id: 'run-1', ...data }));
  });

  it('records a success row with items and duration and returns the work result', async () => {
    const result = await runCronWithObservability('test-route', async () => ({
      itemsProcessed: 3,
      detail: { retentionDays: 7 },
      response: { summary: 'ok' },
    }));

    expect(result.itemsProcessed).toBe(3);
    expect(result.response).toEqual({ summary: 'ok' });

    const row = mocks.prisma.cronRun.create.mock.calls[0][0].data;
    expect(row.route).toBe('test-route');
    expect(row.outcome).toBe('success');
    expect(row.itemsProcessed).toBe(3);
    expect(row.durationMs).toBeGreaterThanOrEqual(0);
    expect(row.errorClass).toBeUndefined();
    expect(row.detail).toEqual(expect.objectContaining({
      evidenceVersion: 1,
      correlationId: expect.any(String),
      summary: 'Scheduled job completed and processed 3 item(s).',
      retentionDays: 7,
    }));
    expect(mocks.observeCronRun).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-1' }));
  });

  it('rethrows work failures after recording a failed row', async () => {
    const boom = new Error('SMTP send failed');
    await expect(
      runCronWithObservability('test-route', async () => {
        throw boom;
      })
    ).rejects.toBe(boom);

    const row = mocks.prisma.cronRun.create.mock.calls[0][0].data;
    expect(row.outcome).toBe('failed');
    expect(row.errorClass).toBe('smtp_error');
    expect(row.itemsProcessed).toBe(0);
    expect(row.detail).toEqual(expect.objectContaining({
      correlationId: expect.any(String),
      summary: 'Scheduled job failed with smtp_error.',
    }));
  });

  it('never lets observability failure break the job', async () => {
    mocks.prisma.cronRun.create.mockRejectedValue(new Error('evidence store down'));

    const result = await runCronWithObservability('test-route', async () => ({
      itemsProcessed: 1,
    }));
    expect(result.itemsProcessed).toBe(1);

    await expect(
      runCronWithObservability('test-route', async () => {
        throw new Error('real failure still propagates');
      })
    ).rejects.toThrow('real failure still propagates');

    expect(mocks.appLogger.error).toHaveBeenCalled();
  });
});

describe('checkCronModuleEnabled', () => {
  beforeEach(() => {
    mocks.prisma.cronRun.create.mockReset();
    mocks.observeCronRun.mockReset();
    mocks.observeCronRun.mockResolvedValue(undefined);
    mocks.prisma.cronRun.create.mockImplementation(async ({ data }) => ({ id: 'run-1', ...data }));
    mocks.isEnabled.mockReset();
  });

  it('returns true and records nothing when the module is enabled', async () => {
    mocks.isEnabled.mockResolvedValue(true);

    await expect(
      checkCronModuleEnabled('process-mass-email', 'communications', mocks.isEnabled)
    ).resolves.toBe(true);
    expect(mocks.prisma.cronRun.create).not.toHaveBeenCalled();
  });

  it('records a module-disabled skip and returns false when disabled', async () => {
    mocks.isEnabled.mockResolvedValue(false);

    await expect(
      checkCronModuleEnabled('process-mass-email', 'communications', mocks.isEnabled)
    ).resolves.toBe(false);

    const row = mocks.prisma.cronRun.create.mock.calls[0][0].data;
    expect(row.route).toBe('process-mass-email');
    expect(row.outcome).toBe('skipped_module_disabled');
    expect(row.itemsProcessed).toBe(0);
  });
});
