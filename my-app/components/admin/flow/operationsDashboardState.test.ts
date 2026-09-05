import { describe, expect, it } from 'vitest';
import { INITIAL_OPERATIONS_JOB, INITIAL_OPERATIONS_OVERVIEW, operationsJobReducer, operationsOverviewReducer } from './operationsDashboardState';

const job = (route: string) => ({ route, label: route, description: 'Synthetic job', expectedIntervalSeconds: 60, enabledEnvKey: null });

describe('operation evidence state ownership', () => {
  it('selects a job and clears the prior error in one transition', () => {
    const state = operationsJobReducer({ ...INITIAL_OPERATIONS_JOB, jobError: 'Old error' }, { type: 'selected', job: job('new') });
    expect(state.selectedJob?.route).toBe('new');
    expect(state.jobLoading).toBe(true);
    expect(state.jobError).toBe('');
  });

  it('rejects old-job data, errors and completion while the new job is loading', () => {
    const current = operationsJobReducer(INITIAL_OPERATIONS_JOB, { type: 'selected', job: job('new') });
    expect(operationsJobReducer(current, { type: 'loaded', route: 'old', runs: [], signals: [], events: [], evidencePolicy: null })).toBe(current);
    expect(operationsJobReducer(current, { type: 'failed', route: 'old', error: 'Old error' })).toBe(current);
    expect(operationsJobReducer(current, { type: 'finished', route: 'old' })).toBe(current);
  });

  it('finishes failed current work and closes the whole evidence view', () => {
    const selected = operationsJobReducer(INITIAL_OPERATIONS_JOB, { type: 'selected', job: job('current') });
    const failed = operationsJobReducer(selected, { type: 'failed', route: 'current', error: 'Unavailable' });
    const finished = operationsJobReducer(failed, { type: 'finished', route: 'current' });
    expect(finished.jobLoading).toBe(false);
    expect(finished.jobError).toBe('Unavailable');
    const closed = operationsJobReducer(finished, { type: 'closed' });
    expect(closed).toEqual(INITIAL_OPERATIONS_JOB);
    expect(operationsJobReducer(closed, { type: 'finished', route: 'current' })).toBe(closed);
  });

  it('retains available scheduler evidence if a later source fails', () => {
    const loaded = operationsOverviewReducer(INITIAL_OPERATIONS_OVERVIEW, { type: 'schedulerLoaded', routeHealth: [], registry: [job('current')], runs: [], flowRuns: [] });
    const failed = operationsOverviewReducer(loaded, { type: 'failed', error: 'Signals unavailable' });
    const finished = operationsOverviewReducer(failed, { type: 'finished' });
    expect(finished.registry).toEqual([job('current')]);
    expect(finished.loading).toBe(false);
    expect(finished.error).toBe('Signals unavailable');
    expect(operationsOverviewReducer(finished, { type: 'alertsLoaded', alerts: [], available: false }).alertsAvailable).toBe(false);
  });
});
