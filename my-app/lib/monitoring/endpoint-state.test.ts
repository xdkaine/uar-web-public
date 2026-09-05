import { describe, expect, it } from 'vitest';

import { nextEndpointState } from './endpoint-state';

const BASE = { currentState: 'up', consecutiveFailures: 0, consecutiveSuccesses: 0 };

describe('endpoint transition hysteresis', () => {
  it('transitions down only after the configured consecutive failures', () => {
    expect(nextEndpointState(BASE, false, 2, 2)).toMatchObject({ currentState: 'up', transition: null, consecutiveFailures: 1 });
    expect(nextEndpointState({ ...BASE, consecutiveFailures: 1 }, false, 2, 2)).toMatchObject({ currentState: 'down', transition: 'failed' });
  });

  it('transitions up only after the configured consecutive recoveries', () => {
    const down = { currentState: 'down', consecutiveFailures: 3, consecutiveSuccesses: 1 };
    expect(nextEndpointState(down, true, 2, 2)).toMatchObject({ currentState: 'up', transition: 'recovered', consecutiveSuccesses: 2 });
  });

  it('establishes an unknown target as up after its first success', () => {
    expect(nextEndpointState({ ...BASE, currentState: 'unknown' }, true, 2, 2)).toMatchObject({ currentState: 'up', transition: null });
  });
});
