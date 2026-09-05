import type { RouteHealth } from './operationsHealth';
import type { CronRouteDescriptor, CronRunRow, OperationalSignal, OperationalSignalEvent, EvidencePolicy, ServiceAlert, FlowRunSummary } from './OperationsDashboardTypes';

export interface OperationsOverviewState {
  routeHealth: RouteHealth[];
  registry: CronRouteDescriptor[];
  recentRuns: CronRunRow[];
  flowRuns: FlowRunSummary[];
  alerts: ServiceAlert[];
  alertsAvailable: boolean;
  activeSignals: OperationalSignal[];
  accessRequestLinksAvailable: boolean;
  loading: boolean;
  error: string;
}

export const INITIAL_OPERATIONS_OVERVIEW: OperationsOverviewState = {
  routeHealth: [], registry: [], recentRuns: [], flowRuns: [], alerts: [], alertsAvailable: true,
  activeSignals: [], accessRequestLinksAvailable: false, loading: true, error: '',
};

type OverviewAction =
  | { type: 'started' }
  | { type: 'schedulerLoaded'; routeHealth: RouteHealth[]; registry: CronRouteDescriptor[]; runs: CronRunRow[]; flowRuns: FlowRunSummary[] }
  | { type: 'alertsLoaded'; alerts: ServiceAlert[]; available: boolean }
  | { type: 'signalsLoaded'; signals: OperationalSignal[]; accessRequestLinksAvailable: boolean }
  | { type: 'failed'; error: string }
  | { type: 'finished' };

export function operationsOverviewReducer(state: OperationsOverviewState, action: OverviewAction): OperationsOverviewState {
  switch (action.type) {
    case 'started': return { ...state, error: '' };
    case 'schedulerLoaded': return { ...state, routeHealth: action.routeHealth, registry: action.registry, recentRuns: action.runs, flowRuns: action.flowRuns };
    case 'alertsLoaded': return { ...state, alerts: action.alerts, alertsAvailable: action.available };
    case 'signalsLoaded': return { ...state, activeSignals: action.signals, accessRequestLinksAvailable: action.accessRequestLinksAvailable };
    case 'failed': return { ...state, error: action.error };
    case 'finished': return { ...state, loading: false };
  }
}

export interface OperationsJobState {
  selectedJob: CronRouteDescriptor | null;
  jobRuns: CronRunRow[];
  jobSignals: OperationalSignal[];
  jobEvents: OperationalSignalEvent[];
  evidencePolicy: EvidencePolicy | null;
  jobLoading: boolean;
  jobError: string;
}

export const INITIAL_OPERATIONS_JOB: OperationsJobState = {
  selectedJob: null, jobRuns: [], jobSignals: [], jobEvents: [], evidencePolicy: null, jobLoading: false, jobError: '',
};

type JobAction =
  | { type: 'selected'; job: CronRouteDescriptor }
  | { type: 'loaded'; route: string; runs: CronRunRow[]; signals: OperationalSignal[]; events: OperationalSignalEvent[]; evidencePolicy: EvidencePolicy | null }
  | { type: 'failed'; route: string; error: string }
  | { type: 'finished'; route: string }
  | { type: 'closed' };

export function operationsJobReducer(state: OperationsJobState, action: JobAction): OperationsJobState {
  if (action.type === 'closed') return INITIAL_OPERATIONS_JOB;
  if (action.type === 'selected') return { ...state, selectedJob: action.job, jobLoading: true, jobError: '' };
  if (state.selectedJob?.route !== action.route) return state;
  switch (action.type) {
    case 'loaded': return { ...state, jobRuns: action.runs, jobSignals: action.signals, jobEvents: action.events, evidencePolicy: action.evidencePolicy };
    case 'failed': return { ...state, jobError: action.error };
    case 'finished': return { ...state, jobLoading: false };
  }
}
