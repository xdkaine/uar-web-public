'use client';

import { Badge } from '@/components/ui/badge';
import type { OperationalSignal, CronRunRow, OperationalSignalEvent, EvidencePolicy } from './OperationsDashboardTypes';
import { ClientLocalDate } from '@/components/admin/ClientLocalDate';

export function OperationsActiveEpisodes({ jobSignals }: { jobSignals: OperationalSignal[] }) {
  return (
    <section aria-labelledby="active-episodes-heading">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 id="active-episodes-heading" className="text-sm font-semibold">Active detector episodes</h3>
        <span className="text-xs text-muted-foreground">
          {jobSignals.filter((signal) => signal.status === 'active').length} active
        </span>
      </div>
      {jobSignals.filter((signal) => signal.status === 'active').length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">
          No structured detector currently requires intervention.
        </p>
      ) : (
        <div className="space-y-2">
          {jobSignals.filter((signal) => signal.status === 'active').map((signal) => (
            <div key={signal.id} className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <div className="flex items-start gap-2">
                <Badge variant={signal.severity === 'critical' ? 'destructive' : 'secondary'}>{signal.severity}</Badge>
                <p className="text-sm font-medium">{signal.summary}</p>
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <dt>Reason</dt><dd className="text-right font-mono">{signal.reasonCode}</dd>
                <dt>First seen</dt><dd className="text-right"><ClientLocalDate value={signal.firstSeenAt} /></dd>
                <dt>Last seen</dt><dd className="text-right"><ClientLocalDate value={signal.lastSeenAt} /></dd>
                <dt>Observations</dt><dd className="text-right">{signal.occurrenceCount}</dd>
              </dl>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function OperationsRunHistory({ jobRuns }: { jobRuns: CronRunRow[] }) {
  return (
    <section aria-labelledby="run-history-heading">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 id="run-history-heading" className="text-sm font-semibold">Last {jobRuns.length} runs</h3>
        <span className="text-xs text-muted-foreground">Newest first</span>
      </div>
      {jobRuns.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">No recorded runs.</p>
      ) : (
        <div className="space-y-2">
          {jobRuns.map((run) => {
            const detail = run.detail ?? {};
            const correlationId = typeof detail.correlationId === 'string' ? detail.correlationId : null;
            const summary = typeof detail.summary === 'string' ? detail.summary : null;
            return (
              <article key={run.id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={run.outcome === 'success' ? 'default' : run.outcome === 'failed' ? 'destructive' : 'secondary'}>{run.outcome}</Badge>
                  <time className="text-sm font-medium" dateTime={run.startedAt}><ClientLocalDate value={run.startedAt} /></time>
                  <span className="ml-auto text-xs text-muted-foreground">{run.durationMs ?? 0} ms</span>
                </div>
                {summary ? <p className="mt-2 text-sm text-muted-foreground">{summary}</p> : null}
                <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <dt>Items processed</dt><dd className="text-right">{run.itemsProcessed}</dd>
                  <dt>Error class</dt><dd className="text-right font-mono">{run.errorClass ?? '—'}</dd>
                  <dt>Run ID</dt><dd className="truncate text-right font-mono" title={run.id}>{run.id}</dd>
                  <dt>Correlation</dt><dd className="truncate text-right font-mono" title={correlationId ?? undefined}>{correlationId ?? '—'}</dd>
                </dl>
                {Object.keys(detail).length > 0 ? (
                  <details className="mt-3 border-t pt-2 text-xs">
                    <summary className="cursor-pointer select-none font-medium text-muted-foreground">Sanitized result details</summary>
                    <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-3 text-[11px] leading-relaxed">{JSON.stringify(detail, null, 2)}</pre>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export function OperationsDetectorEvidence({ jobEvents, evidencePolicy }: { jobEvents: OperationalSignalEvent[]; evidencePolicy: EvidencePolicy | null }) {
  return (
    <section aria-labelledby="evidence-history-heading">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h3 id="evidence-history-heading" className="text-sm font-semibold">Detector evidence</h3>
        {evidencePolicy ? (
          <span className="text-xs text-muted-foreground">Archive eligible after {evidencePolicy.archiveEligibleAfterDays} days</span>
        ) : null}
      </div>
      {jobEvents.length === 0 ? (
        <p className="rounded-md border border-dashed px-3 py-3 text-sm text-muted-foreground">No detector transitions recorded.</p>
      ) : (
        <div className="space-y-2">
          {jobEvents.map((event) => (
            <details key={event.id} className="rounded-md border p-3 text-xs">
              <summary className="cursor-pointer select-none">
                <span className="mr-2 font-semibold uppercase tracking-wide">{event.transition}</span>
                <span className="text-muted-foreground"><ClientLocalDate value={event.createdAt} /></span>
                <span className="mt-1 block text-sm normal-case text-foreground">{event.summary}</span>
              </summary>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                <dt>Detector</dt><dd className="text-right font-mono">{event.detectorKey}</dd>
                <dt>Reason</dt><dd className="text-right font-mono">{event.signal.reasonCode}</dd>
                <dt>Correlation</dt><dd className="truncate text-right font-mono" title={event.correlationId}>{event.correlationId}</dd>
                <dt>Archive eligible</dt><dd className="text-right"><ClientLocalDate value={event.archiveEligibleAt} format="date" /></dd>
              </dl>
              <pre className="mt-3 max-h-64 overflow-auto rounded bg-muted p-3 text-[11px] leading-relaxed">{JSON.stringify(event.evidence, null, 2)}</pre>
            </details>
          ))}
        </div>
      )}
      {evidencePolicy ? (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Evidence remains in the hot store until a verified archive worker is enabled. The manifest format is {evidencePolicy.archiveFormat}; cold storage and write-once guarantees require deployment policy and are not claimed by this screen.
        </p>
      ) : null}
    </section>
  );
}
