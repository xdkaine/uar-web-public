import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OPERATION_FILTERS, INITIAL_OPERATION_VIEW, LIFECYCLE_ACTION_LABELS,
  LIFECYCLE_STATUS_LABELS, lifecycleOperationQuery, updateOperationFilters,
} from './lifecycleOperationFilters';

describe('lifecycle action collection filters', () => {
  it('defaults to a bounded newest-first action list with no restrictive filters', () => {
    expect(Object.fromEntries(new URLSearchParams(lifecycleOperationQuery(INITIAL_OPERATION_VIEW))))
      .toEqual({ limit: '15', sort: 'createdAt', direction: 'desc' });
  });

  it('combines search, action, status, scope, and ordering on the server', () => {
    const view = updateOperationFilters(INITIAL_OPERATION_VIEW, {
      search: '  Batch + 17  ', actionType: 'delete_ad', status: 'failed', accountType: 'AD', order: 'oldest',
    });
    expect(Object.fromEntries(new URLSearchParams(lifecycleOperationQuery(view))))
      .toEqual({ limit: '15', search: 'Batch + 17', actionType: 'delete_ad', status: 'failed', accountType: 'AD', sort: 'createdAt', direction: 'asc' });
  });

  it.each(Object.keys(DEFAULT_OPERATION_FILTERS))('resets the cursor atomically when %s changes', (key) => {
    const previous = { filters: DEFAULT_OPERATION_FILTERS, cursors: ['page-two', 'page-three'] };
    const next = updateOperationFilters(previous, { [key]: 'changed' });
    expect(next.cursors).toEqual([]);
    expect(previous.cursors).toEqual(['page-two', 'page-three']);
    expect(new URLSearchParams(lifecycleOperationQuery(next)).has('cursor')).toBe(false);
  });

  it.each([
    ['newest', 'createdAt', 'desc'], ['oldest', 'createdAt', 'asc'],
    ['username_asc', 'targetUsername', 'asc'], ['username_desc', 'targetUsername', 'desc'],
  ])('maps %s to the supported API sort', (order, sort, direction) => {
    const params = new URLSearchParams(lifecycleOperationQuery(updateOperationFilters(INITIAL_OPERATION_VIEW, { order })));
    expect(params.get('sort')).toBe(sort);
    expect(params.get('direction')).toBe(direction);
  });

  it('advances and goes back using the last cursor without changing the filters', () => {
    const view = { filters: { ...DEFAULT_OPERATION_FILTERS, status: 'reconciliation_required' }, cursors: ['page-two', 'page-three'] };
    expect(new URLSearchParams(lifecycleOperationQuery(view)).get('cursor')).toBe('page-three');
    const previous = { ...view, cursors: view.cursors.slice(0, -1) };
    expect(new URLSearchParams(lifecycleOperationQuery(previous)).get('cursor')).toBe('page-two');
    expect(new URLSearchParams(lifecycleOperationQuery(previous)).get('status')).toBe('reconciliation_required');
  });

  it('includes pending work and both canonical and legacy group action labels', () => {
    expect(LIFECYCLE_STATUS_LABELS.pending).toBe('Pending');
    expect(LIFECYCLE_ACTION_LABELS.add_group_member).toBe(LIFECYCLE_ACTION_LABELS.add_to_group);
  });
});
