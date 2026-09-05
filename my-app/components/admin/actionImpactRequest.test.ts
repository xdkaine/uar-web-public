import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ACTION_IMPACT_REQUEST_EVENT,
  requestActionImpact,
  type QueuedImpact,
} from './actionImpactRequest';

describe('requestActionImpact', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('fails closed when called outside a browser', async () => {
    await expect(requestActionImpact({ title: 'Review', description: 'Check the action.' }))
      .resolves.toEqual({ confirmed: false, value: null });
  });

  it('dispatches the request and resolves with the provider decision', async () => {
    const dispatchEvent = vi.fn((event: Event) => event.type.length > 0);
    vi.stubGlobal('window', { dispatchEvent });

    const result = requestActionImpact({
      title: 'Review',
      description: 'Check the action.',
      input: { label: 'Evidence', defaultValue: 'initial' },
    });
    const event = dispatchEvent.mock.calls[0]?.[0] as CustomEvent<QueuedImpact>;

    expect(event.type).toBe(ACTION_IMPACT_REQUEST_EVENT);
    expect(event.detail.value).toBe('initial');
    event.detail.resolve({ confirmed: true, value: 'approved' });
    await expect(result).resolves.toEqual({ confirmed: true, value: 'approved' });
  });
});
