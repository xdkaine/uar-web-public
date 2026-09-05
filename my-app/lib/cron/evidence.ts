const NUMBER_FIELDS = new Set([
  'retentionDays',
  'accessRequestsCleared',
  'batchAccountsCleared',
  'membersCaptured',
  'errorCount',
  'successful',
  'failed',
  'massEmailCampaignsProcessed',
  'campaignsProcessed',
  'processed',
]);

const BOOLEAN_FIELDS = new Set([
  'reachable',
  'communicationsModuleSkipped',
]);

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeIdentifier(value: unknown, maxLength = 120): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxLength && /^[A-Za-z0-9._:-]+$/.test(trimmed)
    ? trimmed
    : undefined;
}

function safeCountRecord(value: unknown): Record<string, number | boolean> | undefined {
  const source = record(value);
  const projected: Record<string, number | boolean> = {};
  for (const [key, entry] of Object.entries(source)) {
    if (!/^[A-Za-z][A-Za-z0-9]{0,60}$/.test(key)) continue;
    if (typeof entry === 'number' && Number.isFinite(entry)) projected[key] = entry;
    if (typeof entry === 'boolean') projected[key] = entry;
  }
  return Object.keys(projected).length > 0 ? projected : undefined;
}

export interface SafeCronDetailInput {
  outcome: string;
  itemsProcessed: number;
  errorClass?: string | null;
  detail?: unknown;
  correlationId?: string;
}

/** Strict allowlist used both before persistence and when reading legacy rows. */
export function projectSafeCronDetail(input: SafeCronDetailInput): Record<string, unknown> {
  const source = record(input.detail);
  const projected: Record<string, unknown> = {
    evidenceVersion: 1,
    summary:
      input.outcome === 'failed'
        ? `Scheduled job failed with ${safeIdentifier(input.errorClass, 80) ?? 'unknown_error'}.`
        : input.outcome === 'skipped_module_disabled'
          ? 'Scheduled job skipped because its module is disabled.'
          : `Scheduled job completed and processed ${Math.max(0, input.itemsProcessed)} item(s).`,
  };

  const correlationId = safeIdentifier(input.correlationId ?? source.correlationId);
  if (correlationId) projected.correlationId = correlationId;
  const status = safeIdentifier(source.status, 80);
  if (status) projected.status = status;
  const moduleId = safeIdentifier(source.moduleId, 120);
  if (moduleId) projected.moduleId = moduleId;

  for (const field of NUMBER_FIELDS) {
    const value = source[field];
    if (typeof value === 'number' && Number.isFinite(value)) projected[field] = value;
  }
  for (const field of BOOLEAN_FIELDS) {
    const value = source[field];
    if (typeof value === 'boolean') projected[field] = value;
  }

  const detectors = safeCountRecord(source.detectors);
  if (detectors) projected.detectors = detectors;
  const outbox = safeCountRecord(source.outbox);
  if (outbox) projected.outbox = outbox;
  return projected;
}

export function projectCronRunForAudit<T extends {
  outcome: string;
  itemsProcessed: number;
  errorClass: string | null;
  detail: unknown;
}>(run: T): Omit<T, 'detail'> & { detail: Record<string, unknown> } {
  return {
    ...run,
    detail: projectSafeCronDetail({
      outcome: run.outcome,
      itemsProcessed: run.itemsProcessed,
      errorClass: run.errorClass,
      detail: run.detail,
    }),
  };
}
