/**
 * Central registry of every scheduled job that drives this portal. The
 * operations dashboard renders ALL entries - including ones that have never
 * run or are disabled - so "nothing recorded" is visible evidence rather than
 * a silent gap. Intervals mirror the docker-compose sidecar defaults; keep
 * both in sync when changing cadence.
 */

export interface CronRouteDescriptor {
  /** Value written to CronRun.route (and matched against rollups). */
  route: string;
  label: string;
  description: string;
  /** Expected cadence used for staleness detection. */
  expectedIntervalSeconds: number;
  /** Compose env var enabling the sidecar scheduler; null = external cron. */
  enabledEnvKey: string | null;
  /** Compose default when the enable variable is absent. */
  enabledByDefault?: boolean;
  /** Optional runtime cadence override passed into the scheduler sidecar and app. */
  intervalEnvKey?: string;
}

export const CRON_ROUTE_REGISTRY: CronRouteDescriptor[] = [
  {
    route: 'process-lifecycle-queue',
    label: 'Lifecycle queue',
    description:
      'Drains queued lifecycle actions and mass-email delivery, then re-invokes the offboard scheduler.',
    expectedIntervalSeconds: 300,
    enabledEnvKey: 'LIFECYCLE_QUEUE_SCHEDULER_ENABLED',
    enabledByDefault: false,
    intervalEnvKey: 'LIFECYCLE_QUEUE_SCHEDULER_INTERVAL_SECONDS',
  },
  {
    route: 'process-offboard-campaigns',
    label: 'Offboard campaigns',
    description: 'Processes offboarding campaign waves, reminders, and enforcement steps.',
    expectedIntervalSeconds: 300,
    enabledEnvKey: 'OFFBOARD_SCHEDULER_ENABLED',
    enabledByDefault: false,
    intervalEnvKey: 'OFFBOARD_SCHEDULER_INTERVAL_SECONDS',
  },
  {
    route: 'process-password-expiration',
    label: 'Password expiration',
    description: 'Sends milestone reminder emails as account passwords approach expiry.',
    expectedIntervalSeconds: 21600,
    enabledEnvKey: 'PASSWORD_EXPIRATION_SCHEDULER_ENABLED',
    enabledByDefault: false,
    intervalEnvKey: 'PASSWORD_EXPIRATION_SCHEDULER_INTERVAL_SECONDS',
  },
  {
    route: 'process-password-cleanup',
    label: 'Credential cleanup',
    description: 'Purges terminal encrypted credentials older than the retention window.',
    expectedIntervalSeconds: 21600,
    enabledEnvKey: 'PASSWORD_CLEANUP_SCHEDULER_ENABLED',
    enabledByDefault: false,
    intervalEnvKey: 'PASSWORD_CLEANUP_INTERVAL_SECONDS',
  },
  {
    route: 'sync-ticket-groups',
    label: 'Ticket group sync',
    description: 'Refreshes AD membership snapshots for allowed ticket groups.',
    expectedIntervalSeconds: 3600,
    enabledEnvKey: 'TICKET_GROUP_SYNC_ENABLED',
    enabledByDefault: false,
    intervalEnvKey: 'TICKET_GROUP_SYNC_INTERVAL_SECONDS',
  },
  {
    route: 'probe-directory',
    label: 'Directory probe',
    description: 'LDAPS health probe feeding service alerts and automation events.',
    expectedIntervalSeconds: 300,
    enabledEnvKey: 'DIRECTORY_PROBE_ENABLED',
    enabledByDefault: false,
    intervalEnvKey: 'DIRECTORY_PROBE_INTERVAL_SECONDS',
  },
  {
    route: 'probe-monitored-endpoints',
    label: 'Monitored endpoints',
    description: 'Runs approved HTTPS and TCP probes and emits thresholded failure/recovery workflow events.',
    expectedIntervalSeconds: 60,
    enabledEnvKey: 'MONITORED_ENDPOINTS_SCHEDULER_ENABLED',
    enabledByDefault: false,
    intervalEnvKey: 'MONITORED_ENDPOINTS_INTERVAL_SECONDS',
  },
  {
    route: 'workflow-tick',
    label: 'Workflow tick',
    description: 'Drains due workflow Wait timers and fires schedule triggers.',
    expectedIntervalSeconds: 60,
    enabledEnvKey: 'WORKFLOW_TICK_ENABLED',
    enabledByDefault: false,
    intervalEnvKey: 'WORKFLOW_TICK_INTERVAL_SECONDS',
  },
  {
    route: 'detect-operational-issues',
    label: 'Operational detectors',
    description: 'Evaluates curated scheduler and access-request intervention conditions.',
    expectedIntervalSeconds: 60,
    enabledEnvKey: 'OPERATIONAL_DETECTOR_SCHEDULER_ENABLED',
    enabledByDefault: false,
    intervalEnvKey: 'OPERATIONAL_DETECTOR_INTERVAL_SECONDS',
  },
  {
    route: 'drain-flow-outbox',
    label: 'Workflow event outbox',
    description: 'Retries durable workflow events independently from schedules and Wait nodes.',
    expectedIntervalSeconds: 60,
    enabledEnvKey: 'FLOW_OUTBOX_SCHEDULER_ENABLED',
    enabledByDefault: false,
    intervalEnvKey: 'FLOW_OUTBOX_INTERVAL_SECONDS',
  },
  {
    route: 'purge-attachment-quarantine',
    label: 'Attachment quarantine purge',
    description: 'Deletes quarantined malware bytes after the fixed retention period while preserving metadata.',
    expectedIntervalSeconds: 86400,
    enabledEnvKey: 'ATTACHMENT_QUARANTINE_PURGE_ENABLED',
    enabledByDefault: false,
    intervalEnvKey: 'ATTACHMENT_QUARANTINE_PURGE_INTERVAL_SECONDS',
  },
  {
    route: 'process-mass-email',
    label: 'Mass email sender',
    description: 'Sends queued mass-email campaign batches when communications module is on.',
    expectedIntervalSeconds: 300,
    enabledEnvKey: 'MASS_EMAIL_SCHEDULER_ENABLED',
    enabledByDefault: false,
    intervalEnvKey: 'MASS_EMAIL_SCHEDULER_INTERVAL_SECONDS',
  },
];

export interface EffectiveCronRouteDescriptor extends CronRouteDescriptor {
  enabled: boolean;
}

function enabledFromEnv(descriptor: CronRouteDescriptor): boolean {
  if (!descriptor.enabledEnvKey) return true;
  const configured = process.env[descriptor.enabledEnvKey]?.trim().toLowerCase();
  if (!configured) return descriptor.enabledByDefault ?? false;
  return configured === 'true';
}

function intervalFromEnv(descriptor: CronRouteDescriptor): number {
  if (!descriptor.intervalEnvKey) return descriptor.expectedIntervalSeconds;
  const raw = process.env[descriptor.intervalEnvKey]?.trim() ?? '';
  const configured = /^\d+$/.test(raw) ? Number(raw) : Number.NaN;
  return Number.isInteger(configured) && configured >= 30 && configured <= 604_800
    ? configured
    : descriptor.expectedIntervalSeconds;
}

export function effectiveCronRouteRegistry(): EffectiveCronRouteDescriptor[] {
  return CRON_ROUTE_REGISTRY.map((descriptor) => ({
    ...descriptor,
    enabled: enabledFromEnv(descriptor),
    expectedIntervalSeconds: intervalFromEnv(descriptor),
  }));
}
