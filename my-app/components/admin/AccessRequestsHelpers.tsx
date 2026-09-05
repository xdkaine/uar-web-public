import type { AccessRequest, AccessRequestListAction, AccessRequestListState, ReviewStageBucket } from './AccessRequestsTypes';

export const INITIAL_ACCESS_REQUEST_LIST_STATE: AccessRequestListState = { searchQuery: '', statusFilter: 'all', typeFilter: 'all', verificationFilter: 'all', eventFilter: '', reviewStageFilter: 'all', currentPage: 1, pageCursors: [], pageSize: 10, sortField: 'createdAt', sortDirection: 'desc', showAdvancedFilters: false };

export function accessRequestListReducer(state: AccessRequestListState, action: AccessRequestListAction): AccessRequestListState {
  switch (action.type) {
    case 'change': return { ...state, [action.field]: action.value, currentPage: 1, pageCursors: [] } as AccessRequestListState;
    case 'sort': return state.sortField === action.field ? { ...state, sortDirection: state.sortDirection === 'asc' ? 'desc' : 'asc', currentPage: 1, pageCursors: [] } : { ...state, sortField: action.field, sortDirection: 'asc', currentPage: 1, pageCursors: [] };
    case 'page': return { ...state, currentPage: action.page };
    case 'next-page': return { ...state, pageCursors: [...state.pageCursors.slice(0, state.currentPage - 1), action.cursor], currentPage: state.currentPage + 1 };
    case 'page-size': return { ...state, pageSize: action.pageSize, currentPage: 1, pageCursors: [] };
    case 'toggle-advanced': return { ...state, showAdvancedFilters: !state.showAdvancedFilters };
    case 'clear': return { ...INITIAL_ACCESS_REQUEST_LIST_STATE, showAdvancedFilters: state.showAdvancedFilters };
  }
}

export interface AccessRequestDataState { items: AccessRequest[]; total: number; summary: Record<string, number>; reviewStageBuckets: ReviewStageBucket[]; nextCursor: string | null; }
export type AccessRequestDataAction = { type: 'loaded'; data: { items: AccessRequest[]; pageInfo: { total: number; nextCursor: string | null }; summary: Record<string, number>; reviewStageBuckets?: ReviewStageBucket[] } } | { type: 'initial'; items: AccessRequest[] };
export function accessRequestDataReducer(state: AccessRequestDataState, action: AccessRequestDataAction): AccessRequestDataState { return action.type === 'initial' ? { ...state, items: action.items } : { items: action.data.items, total: action.data.pageInfo.total, summary: action.data.summary, reviewStageBuckets: action.data.reviewStageBuckets ?? [], nextCursor: action.data.pageInfo.nextCursor }; }

export function getStatusBadge(request: AccessRequest) {
  const styles: Record<string, string> = { pending_verification: 'bg-muted text-foreground', pending_student_directors: 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200', pending_faculty: 'bg-yellow-100 dark:bg-yellow-950/60 text-yellow-800 dark:text-yellow-200', approved: 'bg-green-100 dark:bg-green-950/60 text-green-800 dark:text-green-200', rejected: 'bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-200', offboarded: 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700' };
  const labels: Record<string, string> = { pending_verification: 'Pending Verification', pending_student_directors: 'Pending Directors', pending_faculty: 'Pending Faculty', approved: 'Approved', rejected: 'Rejected', offboarded: 'Offboarded' };
  return <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${styles[request.status] || 'bg-muted text-foreground'}`}>{request.review?.currentStage?.label || labels[request.status] || request.status}</span>;
}

export function requestQueryParams(state: AccessRequestListState, includeCursor = true): URLSearchParams {
  const params = new URLSearchParams({ limit: String(state.pageSize), sort: state.sortField, direction: state.sortDirection });
  if (state.searchQuery) params.set('search', state.searchQuery);
  if (state.statusFilter !== 'all') params.set('status', state.statusFilter);
  if (state.typeFilter !== 'all') params.set('type', state.typeFilter);
  if (state.verificationFilter !== 'all') params.set('verification', state.verificationFilter);
  if (state.eventFilter) params.set('event', state.eventFilter);
  if (state.reviewStageFilter !== 'all') { const [workflowVersionId, stageKey] = state.reviewStageFilter.split('::'); params.set('workflowVersionId', workflowVersionId); params.set('stageKey', stageKey); }
  // Each stored cursor begins the following page: the cursor received with
  // page one is therefore used when requesting page two.
  const cursor = state.pageCursors[state.currentPage - 2];
  if (includeCursor && cursor) params.set('cursor', cursor);
  return params;
}
