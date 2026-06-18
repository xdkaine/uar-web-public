import { describe, expect, it } from 'vitest';
import { calculateOffboardScheduledWindow } from './offboard-scheduler-window';

describe('calculateOffboardScheduledWindow', () => {
  const now = new Date('2026-06-12T12:00:00.000Z');

  it('returns no window on first startup so existing backlog is not processed', () => {
    expect(calculateOffboardScheduledWindow(null, now, 900)).toBeNull();
    expect(calculateOffboardScheduledWindow('invalid', now, 900)).toBeNull();
  });

  it('continues from a recent successful run', () => {
    expect(calculateOffboardScheduledWindow('2026-06-12T11:55:00.000Z', now, 900))
      .toEqual({
        startExclusive: new Date('2026-06-12T11:55:00.000Z'),
        endInclusive: now,
        protectedBacklog: false,
      });
  });

  it('caps recovery at the grace window instead of replaying an old backlog', () => {
    expect(calculateOffboardScheduledWindow('2026-06-10T12:00:00.000Z', now, 900))
      .toEqual({
        startExclusive: new Date('2026-06-12T11:45:00.000Z'),
        endInclusive: now,
        protectedBacklog: true,
      });
  });
});
