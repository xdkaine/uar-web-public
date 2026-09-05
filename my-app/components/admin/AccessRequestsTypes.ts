import type { Dispatch, ReactNode } from 'react';
import type { ToastType } from '@/components/Toast';

export interface AccessRequest {
  id: string;
  createdAt: string;
  name: string;
  email: string;
  isInternal: boolean;
  needsDomainAccount: boolean;
  institution?: string;
  eventReason?: string;
  eventId?: string;
  event?: { id: string; name: string };
  accountExpiresAt?: string;
  isVerified: boolean;
  status: string;
  verifiedAt?: string;
  review?: { workflow: { version: number; source: string; warning: string | null }; currentStage: { key: string; label: string } | null };
}

export type ReviewStageBucket = { workflowVersionId: string; workflowVersion: number; workflowSource: string; stageKey: string; label: string; count: number };
export type StatusFilter = 'all' | 'pending_verification' | 'pending_student_directors' | 'pending_faculty' | 'approved' | 'rejected' | 'offboarded';
export type TypeFilter = 'all' | 'internal' | 'external';
export type VerificationFilter = 'all' | 'verified' | 'unverified';

export interface AccessRequestListState {
  searchQuery: string;
  statusFilter: StatusFilter;
  typeFilter: TypeFilter;
  verificationFilter: VerificationFilter;
  eventFilter: string;
  reviewStageFilter: string;
  currentPage: number;
  pageCursors: string[];
  pageSize: number;
  sortField: 'createdAt' | 'name' | 'email' | 'status';
  sortDirection: 'asc' | 'desc';
  showAdvancedFilters: boolean;
}

export type AccessRequestListAction =
  | { type: 'change'; field: keyof Pick<AccessRequestListState, 'searchQuery' | 'statusFilter' | 'typeFilter' | 'verificationFilter' | 'eventFilter' | 'reviewStageFilter'>; value: string }
  | { type: 'sort'; field: AccessRequestListState['sortField'] }
  | { type: 'page'; page: number }
  | { type: 'next-page'; cursor: string }
  | { type: 'page-size'; pageSize: number }
  | { type: 'toggle-advanced' }
  | { type: 'clear' };

export interface AccessRequestsDisplayModel {
  totalRequests: number;
  pendingVerification: number;
  approved: number;
  reviewStageBuckets: ReviewStageBucket[];
  setReviewStageFilter: (value: string) => void;
  lastUpdated: Date | null;
  isPolling: boolean;
  isPollingLoading: boolean;
  togglePolling: () => void;
  refresh: () => Promise<void>;
  summary: Record<string, number>;
  collectionTotal: number;
  searchQuery: string;
  statusFilter: StatusFilter;
  reviewStageFilter: string;
  typeFilter: TypeFilter;
  verificationFilter: VerificationFilter;
  eventFilter: string;
  setSearchQuery: (value: string) => void;
  setStatusFilter: (value: StatusFilter) => void;
  setTypeFilter: (value: TypeFilter) => void;
  setVerificationFilter: (value: VerificationFilter) => void;
  setEventFilter: (value: string) => void;
  currentPage: number;
  setCurrentPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  setShowAdvancedFilters: () => void;
  showAdvancedFilters: boolean;
  exportToCSV: () => void;
  availableEvents: string[];
  dispatch: Dispatch<AccessRequestListAction>;
  sortedRequests: AccessRequest[];
  paginatedRequests: AccessRequest[];
  totalPages: number;
  pageSize: number;
  nextCursor: string | null;
  handleSort: (field: AccessRequestListState['sortField']) => void;
  sortField: AccessRequestListState['sortField'];
  sortDirection: 'asc' | 'desc';
  getStatusBadge: (request: AccessRequest) => ReactNode;
  resendingId: string | null;
  handleResendVerification: (requestId: string) => Promise<void>;
  toast: { message: string; type: ToastType; isVisible: boolean };
  hideToast: () => void;
}
