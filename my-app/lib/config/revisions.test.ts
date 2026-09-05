import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  prisma: {
    configurationRevision: { create: vi.fn() },
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mocks.prisma }));

import {
  normalizeRevisionReason,
  recordConfigRevision,
  SECRET_REVISION_MARKER,
} from './revisions';

describe('normalizeRevisionReason', () => {
  it('returns undefined for non-string and blank reasons', () => {
    expect(normalizeRevisionReason(undefined)).toBeUndefined();
    expect(normalizeRevisionReason(42)).toBeUndefined();
    expect(normalizeRevisionReason('   ')).toBeUndefined();
    expect(normalizeRevisionReason('')).toBeUndefined();
  });

  it('trims and bounds long reasons to 500 characters', () => {
    expect(normalizeRevisionReason('  rotated per ticket  ')).toBe('rotated per ticket');
    const long = 'a'.repeat(600);
    expect(normalizeRevisionReason(long)).toHaveLength(500);
  });
});

describe('recordConfigRevision', () => {
  beforeEach(() => {
    mocks.prisma.configurationRevision.create.mockReset();
    mocks.prisma.configurationRevision.create.mockResolvedValue({});
  });

  it('persists key, values, kind, actor, and reason', async () => {
    await recordConfigRevision({
      key: 'smtp.host',
      previousValue: 'old.example.com',
      newValue: 'new.example.com',
      changeKind: 'update',
      changedBy: 'admin1',
      reason: 'relay migration',
    });

    expect(mocks.prisma.configurationRevision.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: 'smtp.host',
        changeKind: 'update',
        changedBy: 'admin1',
        reason: 'relay migration',
      }),
    });
  });

  it('serializes object values into JSON-safe structures', async () => {
    await recordConfigRevision({
      key: 'ldap.adminGroups',
      previousValue: ['a', 'b'],
      newValue: ['c'],
      changeKind: 'update',
      changedBy: 'admin1',
    });

    const call = mocks.prisma.configurationRevision.create.mock.calls[0][0];
    expect(call.data.previousValue).toEqual(['a', 'b']);
    expect(call.data.newValue).toEqual(['c']);
  });

  it('maps unserializable values to the Prisma JSON null sentinel instead of failing', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    await recordConfigRevision({
      key: 'x.key',
      previousValue: cyclic,
      newValue: undefined,
      changeKind: 'clear',
      changedBy: 'admin1',
    });

    const call = mocks.prisma.configurationRevision.create.mock.calls[0][0];
    // Nullable Json columns require Prisma's DbNull sentinel for SQL NULL in
    // Prisma 7; a plain null is rejected at runtime.
    expect(call.data.previousValue).toBe(Prisma.DbNull);
    expect(call.data.newValue).toBe(Prisma.DbNull);
  });
});

describe('SECRET_REVISION_MARKER', () => {
  it('never contains credential material by construction', () => {
    // The marker is a fixed phrase; callers must never substitute real
    // secret values for it.
    expect(SECRET_REVISION_MARKER).toBe('(encrypted value changed)');
    expect(typeof SECRET_REVISION_MARKER).toBe('string');
  });
});
