import { describe, expect, it } from 'vitest';
import { maintenanceStatusHealthy, purgeExpiredDeviceObservations } from './prune-device-observations';

describe('device observation retention maintenance', () => {
  it('deletes in bounded batches and reports a remaining backlog', async () => {
    const ids = ['1', '2', '3', '4', '5'];
    const store = {
      async findMany(args: unknown) {
        const take = (args as { take: number }).take;
        return ids.slice(0, take).map((id) => ({ id }));
      },
      async deleteMany(args: unknown) {
        const deleting = (args as { where: { id: { in: string[] } } }).where.id.in;
        for (const id of deleting) ids.splice(ids.indexOf(id), 1);
        return { count: deleting.length };
      },
    };
    await expect(
      purgeExpiredDeviceObservations(store, { batchSize: 2, maxBatches: 2, now: new Date(0) })
    ).resolves.toEqual({ deleted: 4, batches: 2, backlogRemaining: true });
    expect(ids).toEqual(['5']);
  });

  it('returns cleanly when there is no expired evidence', async () => {
    const store = { findMany: async () => [], deleteMany: async () => ({ count: 0 }) };
    await expect(purgeExpiredDeviceObservations(store)).resolves.toEqual({
      deleted: 0,
      batches: 0,
      backlogRemaining: false,
    });
  });

  it('fails health before a successful pass and after the success timestamp becomes stale', () => {
    const now = Date.parse('2026-08-27T12:00:00.000Z');
    expect(maintenanceStatusHealthy(null, now, 3600, 300)).toBe(false);
    expect(maintenanceStatusHealthy({
      lastAttemptAt: '2026-08-27T11:30:00.000Z',
      lastSuccessAt: '2026-08-27T11:30:00.000Z',
    }, now, 3600, 300)).toBe(true);
    expect(maintenanceStatusHealthy({
      lastAttemptAt: '2026-08-27T10:00:00.000Z',
      lastSuccessAt: '2026-08-27T10:00:00.000Z',
      lastError: 'database unavailable',
    }, now, 3600, 300)).toBe(false);
  });
});
