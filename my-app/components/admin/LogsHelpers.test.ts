import { describe, expect, it } from 'vitest';
import { activeLogFilterCount, buildLogsQuery, EMPTY_LOG_FILTERS, updateLogsFilters } from './LogsHelpers';

describe('audit log filter queries', () => {
  it('serializes only active filters with the selected page and limit', () => {
    const query = buildLogsQuery({ ...EMPTY_LOG_FILTERS, category: 'lifecycle', username: 'alex', search: 'reconcile' }, 3, 100);
    expect(query).toBe('page=3&limit=100&category=lifecycle&username=alex&search=reconcile');
  });

  it('normalizes the all option and counts only active filters', () => {
    const filters = { ...EMPTY_LOG_FILTERS, category: 'all', outcome: 'failure', search: 'directory' };
    expect(activeLogFilterCount(filters)).toBe(2);
    expect(buildLogsQuery(filters, 1, 50)).not.toContain('category=all');
  });
});

describe('audit log filter paging', () => {
  it('returns to the first page only when the filter query changes', () => {
    const current = { ...EMPTY_LOG_FILTERS, category: 'lifecycle' };
    expect(updateLogsFilters(current, current, 4)).toEqual({ filters: current, page: 4 });
    expect(updateLogsFilters(current, { ...current, outcome: 'failure' }, 4)).toEqual({ filters: { ...current, outcome: 'failure' }, page: 1 });
  });
});
