import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), poll: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ fetchWithCsrf: mocks.fetch }));
vi.mock('@/hooks/useToast', () => ({ useToast: () => ({ showToast: vi.fn() }) }));
vi.mock('@/hooks/usePolling', () => ({ usePolling: mocks.poll }));

import LifecycleOperationsPanel from './LifecycleOperationsPanel';

describe('lifecycle operations action view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.poll.mockReturnValue({ isLoading: true, isPolling: true, togglePolling: vi.fn(), refresh: vi.fn(), lastUpdated: null, error: null });
  });

  it('renders labeled action filters without the reviewed-plan section or summary tiles', () => {
    const html = renderToStaticMarkup(createElement(LifecycleOperationsPanel));
    for (const label of ['Lifecycle actions', 'Search actions', 'Action type', 'Status', 'Account scope', 'Sort by', 'Clear filters']) {
      expect(html).toContain(label);
    }
    expect(html).not.toContain('Reviewed deletion plans');
    expect(html).not.toContain('Finalize expired plan');
    expect(html).not.toContain('lg:grid-cols-7');
  });

  it('loads only lifecycle actions and has no dependency on deletion-plan access', async () => {
    const response = { items: [], pageInfo: { total: 0, nextCursor: null } };
    mocks.fetch.mockResolvedValue({ ok: true, json: async () => response });
    renderToStaticMarkup(createElement(LifecycleOperationsPanel));
    await expect(mocks.poll.mock.calls[0][0]()).resolves.toEqual(response);
    expect(mocks.fetch).toHaveBeenCalledExactlyOnceWith('/api/admin/account-lifecycle?limit=15&sort=createdAt&direction=desc');
  });

  it('shows loading failures as errors, not as a successful empty result', () => {
    mocks.poll.mockReturnValue({ isLoading: false, isPolling: false, togglePolling: vi.fn(), refresh: vi.fn(), lastUpdated: null, error: new Error('Unable to load lifecycle operations') });
    const html = renderToStaticMarkup(createElement(LifecycleOperationsPanel));
    expect(html).toContain('role="alert"');
    expect(html).toContain('Actions unavailable');
    expect(html).not.toContain('No lifecycle actions have been recorded');
  });
});
