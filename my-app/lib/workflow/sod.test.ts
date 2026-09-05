import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getConfigValue: vi.fn(),
}));

vi.mock('@/lib/config/resolver', () => ({
  getConfigValue: mocks.getConfigValue,
}));

import {
  evaluateApprovalSeparationOfDuties,
  findPriorStageActionsByActor,
  isValidSodMode,
  resolveSodMode,
} from './sod';

function requestFixture(overrides: Record<string, unknown> = {}) {
  return {
    acknowledgedBy: null as string | null,
    acknowledgedAt: null as Date | null,
    sentToFacultyBy: null as string | null,
    sentToFacultyAt: null as Date | null,
    manuallyAssignedBy: null as string | null,
    manuallyAssignedAt: null as Date | null,
    ...overrides,
  };
}

describe('resolveSodMode', () => {
  beforeEach(() => {
    mocks.getConfigValue.mockReset();
  });

  it('returns the configured mode', async () => {
    mocks.getConfigValue.mockResolvedValue('flag');
    await expect(resolveSodMode()).resolves.toBe('flag');
  });

  it('falls back to off for unusable stored values', async () => {
    mocks.getConfigValue.mockResolvedValue('turbo');
    await expect(resolveSodMode()).resolves.toBe('off');
  });

  it('falls back to off when the configuration store is unreadable', async () => {
    mocks.getConfigValue.mockRejectedValue(new Error('store down'));
    await expect(resolveSodMode()).resolves.toBe('off');
  });
});

describe('isValidSodMode', () => {
  it('accepts only the three documented modes', () => {
    expect(isValidSodMode('off')).toBe(true);
    expect(isValidSodMode('flag')).toBe(true);
    expect(isValidSodMode('block')).toBe(true);
    expect(isValidSodMode('OFF')).toBe(false);
    expect(isValidSodMode(undefined)).toBe(false);
    expect(isValidSodMode(42)).toBe(false);
  });
});

describe('findPriorStageActionsByActor', () => {
  it('returns empty when the actor performed no earlier stage action', () => {
    const request = requestFixture({ acknowledgedBy: 'directorA' });
    expect(findPriorStageActionsByActor(request, 'facultyB')).toEqual([]);
  });

  it('detects a same-actor acknowledgement before approval', () => {
    const request = requestFixture({
      acknowledgedBy: 'DirectorA',
      acknowledgedAt: new Date('2026-01-01T10:00:00Z'),
    });
    const prior = findPriorStageActionsByActor(request, 'directora');
    expect(prior).toHaveLength(1);
    expect(prior[0].field).toBe('acknowledgedBy');
    expect(prior[0].label).toBe('Earlier-stage acknowledgement');
    expect(prior[0].at).toBe('2026-01-01T10:00:00.000Z');
  });

  it('detects faculty handoff and manual assignment by the same actor', () => {
    const request = requestFixture({
      sentToFacultyBy: 'mixedActor',
      sentToFacultyAt: new Date('2026-02-02T09:00:00Z'),
      manuallyAssignedBy: 'MIXEDACTOR',
      manuallyAssignedAt: new Date('2026-02-01T09:00:00Z'),
    });
    const prior = findPriorStageActionsByActor(request, 'mixedactor');
    const fields = prior.map((entry) => entry.field).sort();
    expect(fields).toEqual(['manuallyAssignedBy', 'sentToFacultyBy']);
  });

  it('ignores blank actor usernames defensively', () => {
    const request = requestFixture({ acknowledgedBy: 'someone' });
    expect(findPriorStageActionsByActor(request, '   ')).toEqual([]);
  });
});

describe('evaluateApprovalSeparationOfDuties', () => {
  beforeEach(() => {
    mocks.getConfigValue.mockReset();
  });

  it('never violates in off mode even with same-actor history', async () => {
    mocks.getConfigValue.mockResolvedValue('off');
    const evaluation = await evaluateApprovalSeparationOfDuties(
      requestFixture({ acknowledgedBy: 'sameUser' }),
      'sameUser'
    );
    expect(evaluation.mode).toBe('off');
    expect(evaluation.violated).toBe(false);
    // Prior actions are still reported so callers can log context if desired.
    expect(evaluation.priorActions).toHaveLength(1);
  });

  it('flags without blocking in flag mode', async () => {
    mocks.getConfigValue.mockResolvedValue('flag');
    const evaluation = await evaluateApprovalSeparationOfDuties(
      requestFixture({ acknowledgedBy: 'sameUser' }),
      'sameuser'
    );
    expect(evaluation.violated).toBe(true);
  });

  it('reports violation in block mode for downstream rejection', async () => {
    mocks.getConfigValue.mockResolvedValue('block');
    const evaluation = await evaluateApprovalSeparationOfDuties(
      requestFixture({ manuallyAssignedBy: 'ops1' }),
      'OPS1'
    );
    expect(evaluation.violated).toBe(true);
    expect(evaluation.priorActions[0].label).toBe('Manual account assignment');
  });

  it('is clean when a different reviewer approves', async () => {
    mocks.getConfigValue.mockResolvedValue('block');
    const evaluation = await evaluateApprovalSeparationOfDuties(
      requestFixture({ acknowledgedBy: 'directorA', sentToFacultyBy: 'facultyB' }),
      'facultyC'
    );
    expect(evaluation.violated).toBe(false);
    expect(evaluation.priorActions).toHaveLength(0);
  });
});
