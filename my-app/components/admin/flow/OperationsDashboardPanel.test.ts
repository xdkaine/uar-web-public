import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import OperationsDashboardPanel from './OperationsDashboardPanel';

import { healthFor } from './operationsHealth';

describe('operations scheduler health', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('uses the five-minute minimum staleness threshold in milliseconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:05:00Z'));
    const entry = {
      route: '/api/cron/minutely',
      lastRunAt: '2026-08-28T00:00:01Z',
      outcomes: { success: 1 },
    };

    expect(healthFor({ ...entry, latestOutcome: 'success' }, 60)).toBe('healthy');
    vi.setSystemTime(new Date('2026-08-28T00:05:02Z'));
    expect(healthFor({ ...entry, latestOutcome: 'success' }, 60)).toBe('stale');
  });

  it('uses three expected cadences when that is longer than five minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-28T00:30:00Z'));
    const entry = {
      route: '/api/cron/ten-minutes',
      lastRunAt: '2026-08-28T00:00:01Z',
      outcomes: { success: 4 },
    };

    expect(healthFor({ ...entry, latestOutcome: 'success' }, 600)).toBe('healthy');
    vi.setSystemTime(new Date('2026-08-28T00:30:02Z'));
    expect(healthFor({ ...entry, latestOutcome: 'success' }, 600)).toBe('stale');
  });

  it('reports the latest failed run instead of averaging it away', () => {
    expect(healthFor({
      route: '/api/cron/job',
      lastRunAt: new Date().toISOString(),
      latestOutcome: 'failed',
      outcomes: { success: 39, failed: 1 },
    }, 60)).toBe('failing');
  });
});

describe('operations initial server rendering', () => {
  it('cannot render locale-dependent evidence before its client fetch completes', () => {
    const format = vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(() => { throw new Error('Locale reached initial HTML'); });
    const dateFormat = vi.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(() => { throw new Error('Date reached initial HTML'); });
    try {
      const initialHtml = renderToStaticMarkup(createElement(OperationsDashboardPanel));
      expect(initialHtml).toContain('animate-spin');
      expect(initialHtml).not.toContain('Scheduler health');
      expect(format).not.toHaveBeenCalled();
      expect(dateFormat).not.toHaveBeenCalled();
    } finally {
      format.mockRestore();
      dateFormat.mockRestore();
    }
  });
});
