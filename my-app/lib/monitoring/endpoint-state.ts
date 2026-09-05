export interface EndpointStateInput {
  currentState: string;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
}

export function nextEndpointState(
  current: EndpointStateInput,
  reachable: boolean,
  failureThreshold: number,
  recoveryThreshold: number
): EndpointStateInput & { transition: 'failed' | 'recovered' | null } {
  if (reachable) {
    const successes = current.consecutiveSuccesses + 1;
    if (current.currentState === 'down' && successes >= recoveryThreshold) {
      return { currentState: 'up', consecutiveFailures: 0, consecutiveSuccesses: successes, transition: 'recovered' };
    }
    return {
      currentState: current.currentState === 'unknown' ? 'up' : current.currentState,
      consecutiveFailures: 0,
      consecutiveSuccesses: successes,
      transition: null,
    };
  }
  const failures = current.consecutiveFailures + 1;
  if (current.currentState !== 'down' && failures >= failureThreshold) {
    return { currentState: 'down', consecutiveFailures: failures, consecutiveSuccesses: 0, transition: 'failed' };
  }
  return {
    currentState: current.currentState,
    consecutiveFailures: failures,
    consecutiveSuccesses: 0,
    transition: null,
  };
}
