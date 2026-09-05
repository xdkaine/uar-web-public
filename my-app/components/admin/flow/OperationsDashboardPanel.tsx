'use client';

import { useCallback, useEffect, useRef, useReducer } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, ShieldAlert, Database, Workflow } from 'lucide-react';
import type { CronRouteDescriptor, ServiceAlert } from './OperationsDashboardTypes';
import { INITIAL_OPERATIONS_OVERVIEW, INITIAL_OPERATIONS_JOB, operationsOverviewReducer, operationsJobReducer } from './operationsDashboardState';
import { OperationsSchedulerHealth } from './OperationsSchedulerHealth';
import { OperationsInterventionSignals } from './OperationsInterventionSignals';
import { OperationsJobEvidenceDialog } from './OperationsJobEvidenceDialog';
import { ClientLocalDate } from '@/components/admin/ClientLocalDate';
/** Operations dashboard (ADR-0013): scheduler health, workflow runs, alerts. */
export default function OperationsDashboardPanel() {
  const [overview, dispatchOverview] = useReducer(operationsOverviewReducer, INITIAL_OPERATIONS_OVERVIEW);
  const { routeHealth, registry, recentRuns, alerts, flowRuns, activeSignals, alertsAvailable, accessRequestLinksAvailable, loading, error } = overview;
  const [jobState, dispatchJob] = useReducer(operationsJobReducer, INITIAL_OPERATIONS_JOB);
  const { selectedJob, jobRuns, jobSignals, jobEvents, evidencePolicy, jobLoading, jobError } = jobState;
  const jobRequestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    try {
      dispatchOverview({ type: 'started' });
      const [cronRes, alertRes, signalRes] = await Promise.all([
        fetch('/api/admin/cron-runs?limit=40'),
        fetch('/api/admin/service-alerts').catch(() => null),
        fetch('/api/admin/operational-signals?status=active&limit=40'),
      ]);
      if (!cronRes.ok) throw new Error('Scheduler and workflow evidence is unavailable');
      if (!signalRes.ok) throw new Error('Structured detector evidence is unavailable');

      const cronData = await cronRes.json();
      dispatchOverview({ type: 'schedulerLoaded', routeHealth: cronData.routeHealth ?? [], runs: cronData.runs ?? [], registry: cronData.registry ?? [], flowRuns: cronData.flowRuns ?? [] });

      if (alertRes?.ok) {
        const alertData = await alertRes.json();
        const all: ServiceAlert[] = alertData.alerts ?? [];
        dispatchOverview({ type: 'alertsLoaded', alerts: all.filter((alert) => alert.status === 'active'), available: true });
      } else {
        dispatchOverview({ type: 'alertsLoaded', alerts: [], available: false });
      }

      const signalData = await signalRes.json();
      dispatchOverview({ type: 'signalsLoaded', signals: signalData.signals ?? [], accessRequestLinksAvailable: signalData.capabilities?.accessRequestsRead === true });
    } catch (err) {
      dispatchOverview({ type: 'failed', error: err instanceof Error ? err.message : 'Failed to load operations data' });
    } finally {
      dispatchOverview({ type: 'finished' });
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 60_000);
    return () => {
      clearInterval(interval);
      jobRequestRef.current?.abort();
    };
  }, [load]);

  const loadJobDetails = useCallback(async (job: CronRouteDescriptor) => {
    jobRequestRef.current?.abort();
    const controller = new AbortController();
    jobRequestRef.current = controller;
    dispatchJob({ type: 'selected', job });
    window.history.replaceState(null, '', `${window.location.pathname}?route=${encodeURIComponent(job.route)}`);
    try {
      const response = await fetch(
        `/api/admin/cron-runs?route=${encodeURIComponent(job.route)}&limit=20`,
        { signal: controller.signal }
      );
      if (!response.ok) throw new Error('Run evidence is unavailable');
      const data = await response.json();
      if (controller.signal.aborted) return;
      dispatchJob({ type: 'loaded', route: job.route, runs: data.runs ?? [], signals: data.operationalSignals ?? [], events: data.signalEvents ?? [], evidencePolicy: data.evidencePolicy ?? null });
    } catch (err) {
      if (controller.signal.aborted) return;
      dispatchJob({ type: 'failed', route: job.route, error: err instanceof Error ? err.message : 'Failed to load run evidence' });
    } finally {
      if (!controller.signal.aborted) dispatchJob({ type: 'finished', route: job.route });
    }
  }, []);

  const closeJobDetails = useCallback(() => {
    jobRequestRef.current?.abort();
    jobRequestRef.current = null;
    dispatchJob({ type: 'closed' });
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  useEffect(() => {
    if (registry.length === 0 || selectedJob) return;
    const requestedRoute = new URLSearchParams(window.location.search).get('route');
    const requestedJob = registry.find((job) => job.route === requestedRoute);
    if (requestedJob) void loadJobDetails(requestedJob);
  }, [loadJobDetails, registry, selectedJob]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const healthByRoute = new Map(routeHealth.map((entry) => [entry.route, entry]));
  const scheduledJobs =
    registry.length > 0
      ? registry
      : routeHealth.map((entry) => ({
          route: entry.route,
          label: entry.route,
          description: '',
          expectedIntervalSeconds: 900,
          enabledEnvKey: null,
          enabled: true,
        }));

  return (
    <div className="space-y-4">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Scheduler health table - every registered job, always visible */}
      <OperationsSchedulerHealth scheduledJobs={scheduledJobs} healthByRoute={healthByRoute} loadJobDetails={loadJobDetails} />

      <OperationsInterventionSignals activeSignals={activeSignals} accessRequestLinksAvailable={accessRequestLinksAvailable} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Recent cron executions */}
        <Card id="latest-executions" className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="h-4 w-4 text-primary" /> Latest executions
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-1.5">
            {recentRuns.length === 0 && <p className="text-sm text-muted-foreground">Nothing yet.</p>}
            {recentRuns.slice(0, 12).map((run) => (
              <div key={run.id} className="flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs">
                <Badge variant={run.outcome === 'success' ? 'default' : run.outcome === 'failed' ? 'destructive' : 'secondary'}>
                  {run.outcome}
                </Badge>
                <span className="font-mono truncate flex-1">{run.route}</span>
                {run.durationMs != null && <span className="text-muted-foreground">{run.durationMs} ms</span>}
                <span className="text-muted-foreground shrink-0 w-36 text-right">
                  <ClientLocalDate value={run.startedAt} />
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Active service alerts */}
        <Card id="active-service-alerts" className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4 text-primary" /> Active service alerts
              <Badge variant="secondary">{alerts.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-1.5">
            {!alertsAvailable ? (
              <p className="text-sm text-muted-foreground">Service alerts require additional read permission.</p>
            ) : alerts.length === 0 && (
              <p className="text-sm text-muted-foreground">No active service alerts.</p>
            )}
            {alerts.map((alert) => (
              <div key={alert.id} className="rounded border px-2.5 py-1.5">
                <div className="flex items-center gap-2">
                  <Badge variant={alert.severity === 'critical' ? 'destructive' : 'secondary'}>{alert.severity}</Badge>
                  <span className="truncate text-sm font-medium">{alert.title}</span>
                  <span className="ml-auto text-xs text-muted-foreground shrink-0">
                    ×{alert.occurrenceCount}
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground truncate">{alert.dedupeKey}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Real workflow run evidence, sourced from FlowRun rather than graph definitions. */}
      <Card id="recent-workflow-runs" className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Workflow className="h-4 w-4 text-primary" /> Recent workflow runs
          </CardTitle>
          <CardDescription>
            Recorded executions from immutable workflow versions. Open Workflows to inspect node outcomes.
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          {flowRuns.length === 0 ? (
            <p className="text-sm text-muted-foreground">No workflow runs have been recorded.</p>
          ) : (
            <div className="space-y-1.5">
              {flowRuns.slice(0, 12).map((flow) => (
                <div key={flow.id} className="flex flex-wrap items-center gap-2 rounded border px-2.5 py-1.5 text-xs">
                  <Badge
                    variant={flow.status === 'succeeded' ? 'default' : flow.status === 'failed' ? 'destructive' : 'secondary'}
                  >
                    {flow.status}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {flow.graphName ?? 'Unknown workflow'}{flow.graphVersion ? ` v${flow.graphVersion}` : ''}
                  </span>
                  <span className="max-w-64 truncate font-mono text-muted-foreground">
                    {flow.triggerKey}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    <ClientLocalDate value={flow.startedAt} />
                  </span>
                  {flow.failureClass ? (
                    <span className="w-full truncate text-destructive">{flow.failureClass}</span>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <OperationsJobEvidenceDialog selectedJob={selectedJob} routeHealth={routeHealth} jobLoading={jobLoading} jobError={jobError} jobSignals={jobSignals} jobRuns={jobRuns} jobEvents={jobEvents} evidencePolicy={evidencePolicy} closeJobDetails={closeJobDetails} />
    </div>
  );
}
