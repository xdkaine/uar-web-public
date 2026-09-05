export interface CronRouteDescriptor {
  route: string;
  label: string;
  description: string;
  expectedIntervalSeconds: number;
  enabledEnvKey: string | null;
  enabled?: boolean;
}

export interface CronRunRow {
  id: string;
  route: string;
  outcome: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  itemsProcessed: number;
  errorClass: string | null;
  detail: Record<string, unknown> | null;
}

export interface OperationalSignal {
  id: string;
  detectorKey: string;
  subjectType: string;
  subjectId: string;
  reasonCode: string;
  status: string;
  severity: string;
  summary: string;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  occurrenceCount: number;
}

export interface OperationalSignalEvent {
  id: string;
  transition: string;
  detectorKey: string;
  correlationId: string;
  summary: string;
  evidence: Record<string, unknown>;
  createdAt: string;
  archiveEligibleAt: string;
  archivedAt: string | null;
  signal: {
    subjectId: string;
    reasonCode: string;
    status: string;
  };
}

export interface EvidencePolicy {
  archiveEligibleAfterDays: number;
  retentionMode: string;
  archiveFormat: string;
  archiveStoragePolicy: string;
}

export interface ServiceAlert {
  id: string;
  dedupeKey: string;
  category: string;
  severity: string;
  title: string;
  status: string;
  occurrenceCount: number;
  lastSeenAt: string;
}

export interface FlowRunSummary {
  id: string;
  status: string;
  triggerKey: string;
  graphName?: string;
  graphVersion?: number;
  startedAt: string;
  failureClass?: string | null;
}
