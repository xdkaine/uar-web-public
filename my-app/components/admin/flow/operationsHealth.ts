export interface RouteHealth {
  route: string;
  lastRunAt: string | null;
  latestOutcome: string | null;
  outcomes: Record<string, number>;
}

export function healthFor(
  entry: RouteHealth | undefined,
  expectedIntervalSeconds: number
): 'healthy' | 'failing' | 'stale' | 'unknown' {
  if (!entry) return 'unknown';
  if (entry.latestOutcome === 'failed') return 'failing';
  if (!entry.lastRunAt) return 'unknown';
  // Stale = more than 3x the expected cadence has elapsed since the last run.
  const staleAfterMs = Math.max(expectedIntervalSeconds * 3 * 1000, 5 * 60 * 1000);
  const ageMs = Date.now() - new Date(entry.lastRunAt).getTime();
  if (ageMs > staleAfterMs) return 'stale';
  return 'healthy';
}

export const HEALTH_BADGE: Record<string, { label: string; variant: 'default' | 'destructive' | 'secondary' | 'outline'; className?: string }> = {
  healthy: { label: 'healthy', variant: 'default', className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' },
  failing: { label: 'failing', variant: 'destructive' },
  stale: { label: 'overdue', variant: 'secondary' },
  unknown: { label: 'never run', variant: 'outline' },
  disabled: { label: 'disabled', variant: 'outline', className: 'text-muted-foreground' },
};

export function formatInterval(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}
