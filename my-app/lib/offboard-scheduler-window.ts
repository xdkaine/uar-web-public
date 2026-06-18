export interface OffboardScheduledWindow {
  startExclusive: Date;
  endInclusive: Date;
  protectedBacklog: boolean;
}

export function calculateOffboardScheduledWindow(
  cursorValue: string | null,
  now: Date,
  graceSeconds: number
): OffboardScheduledWindow | null {
  if (!cursorValue) return null;

  const cursor = new Date(cursorValue);
  if (Number.isNaN(cursor.getTime())) return null;

  const graceStart = new Date(now.getTime() - graceSeconds * 1000);
  const startExclusive = new Date(Math.max(cursor.getTime(), graceStart.getTime()));

  return {
    startExclusive,
    endInclusive: now,
    protectedBacklog: cursor < graceStart,
  };
}
