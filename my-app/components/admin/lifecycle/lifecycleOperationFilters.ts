export const LIFECYCLE_ACTION_LABELS: Record<string, string> = {
  disable_ad: 'Disable AD', enable_ad: 'Enable AD', delete_ad: 'Permanently delete AD',
  revoke_vpn: 'Revoke VPN', restore_vpn: 'Restore VPN', delete_vpn_record: 'Delete VPN record',
  promote_vpn_role: 'Promote VPN role', demote_vpn_role: 'Demote VPN role',
  disable_both: 'Disable AD and VPN', enable_both: 'Enable AD and VPN',
  add_group_member: 'Add group member', add_to_group: 'Add group member', remove_from_group: 'Remove group member',
};

export const LIFECYCLE_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending', queued: 'Queued', processing: 'Processing', completed: 'Completed',
  failed: 'Failed', reconciliation_required: 'Reconciliation required', cancelled: 'Cancelled',
};

export const LIFECYCLE_SCOPE_LABELS: Record<string, string> = { AD: 'AD only', VPN: 'VPN only', BOTH: 'AD and VPN' };
export const LIFECYCLE_SORT_LABELS: Record<string, string> = {
  newest: 'Newest first', oldest: 'Oldest first', username_asc: 'Username A–Z', username_desc: 'Username Z–A',
};

export type LifecycleOperationFilters = {
  search: string;
  actionType: string;
  status: string;
  accountType: string;
  order: string;
};

export const DEFAULT_OPERATION_FILTERS: LifecycleOperationFilters = {
  search: '', actionType: 'all', status: 'all', accountType: 'all', order: 'newest',
};

export type LifecycleOperationView = { filters: LifecycleOperationFilters; cursors: string[] };
export const INITIAL_OPERATION_VIEW: LifecycleOperationView = { filters: DEFAULT_OPERATION_FILTERS, cursors: [] };

export function updateOperationFilters(view: LifecycleOperationView, update: Partial<LifecycleOperationFilters>): LifecycleOperationView {
  // A collection cursor is valid only for the exact filters and ordering that
  // produced it. Reset pagination in the same state update as every filter.
  return { filters: { ...view.filters, ...update }, cursors: [] };
}

export function lifecycleOperationQuery({ filters, cursors }: LifecycleOperationView): string {
  const byUsername = filters.order.startsWith('username_');
  const params = new URLSearchParams({
    limit: '15', sort: byUsername ? 'targetUsername' : 'createdAt',
    direction: filters.order === 'oldest' || filters.order === 'username_asc' ? 'asc' : 'desc',
  });
  if (filters.search.trim()) params.set('search', filters.search.trim());
  for (const key of ['actionType', 'status', 'accountType'] as const) {
    if (filters[key] !== 'all') params.set(key, filters[key]);
  }
  const cursor = cursors.at(-1);
  if (cursor) params.set('cursor', cursor);
  return params.toString();
}
