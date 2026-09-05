'use client';

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2 } from 'lucide-react';
import { OperationsActiveEpisodes, OperationsRunHistory, OperationsDetectorEvidence } from './OperationsEvidenceSections';
import { healthFor, HEALTH_BADGE, formatInterval, type RouteHealth } from './operationsHealth';
import type { CronRouteDescriptor, CronRunRow, OperationalSignal, OperationalSignalEvent, EvidencePolicy } from './OperationsDashboardTypes';

interface Props { selectedJob: CronRouteDescriptor | null; routeHealth: RouteHealth[]; jobLoading: boolean; jobError: string; jobSignals: OperationalSignal[]; jobRuns: CronRunRow[]; jobEvents: OperationalSignalEvent[]; evidencePolicy: EvidencePolicy | null; closeJobDetails: () => void }

export function OperationsJobEvidenceDialog({ selectedJob, routeHealth, jobLoading, jobError, jobSignals, jobRuns, jobEvents, evidencePolicy, closeJobDetails }: Props) {
  return (
    <Dialog open={selectedJob !== null} onOpenChange={(open) => { if (!open) closeJobDetails(); }}>
      <DialogContent
        className="left-auto right-0 top-0 grid h-dvh max-h-dvh w-full max-w-xl translate-x-0 translate-y-0 grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden rounded-none border-y-0 border-r-0 p-0 sm:max-w-2xl"
      >
        {selectedJob ? (
          <>
            <DialogHeader className="border-b px-6 py-5 pr-14">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle>{selectedJob.label}</DialogTitle>
                {(() => {
                  const health = selectedJob.enabled === false
                    ? 'disabled'
                    : healthFor(
                        routeHealth.find((entry) => entry.route === selectedJob.route),
                        selectedJob.expectedIntervalSeconds
                      );
                  const badge = HEALTH_BADGE[health];
                  return <Badge variant={badge.variant} className={badge.className}>{badge.label}</Badge>;
                })()}
              </div>
              <DialogDescription>{selectedJob.description}</DialogDescription>
              <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
                <span>{selectedJob.route}</span>
                <span>expected every {formatInterval(selectedJob.expectedIntervalSeconds)}</span>
              </div>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
              {jobLoading ? (
                <div className="flex items-center justify-center py-16 text-muted-foreground">
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading run evidence
                </div>
              ) : jobError ? (
                <Alert variant="destructive"><AlertDescription>{jobError}</AlertDescription></Alert>
              ) : (
                <div className="space-y-7">
                  <OperationsActiveEpisodes jobSignals={jobSignals} />

                  <OperationsRunHistory jobRuns={jobRuns} />

                  <OperationsDetectorEvidence jobEvents={jobEvents} evidencePolicy={evidencePolicy} />
                </div>
              )}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
