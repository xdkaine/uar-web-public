'use client';

import { useState, useMemo, useCallback, useEffect, useReducer, useRef } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { useToast } from '@/hooks/useToast';
import { fetchWithCsrf } from '@/lib/csrf';
import { INITIAL_ACCESS_REQUEST_LIST_STATE, accessRequestDataReducer, accessRequestListReducer, getStatusBadge, requestQueryParams } from './AccessRequestsHelpers';
import type { AccessRequest, AccessRequestsDisplayModel, StatusFilter, TypeFilter, VerificationFilter } from './AccessRequestsTypes';
import { AccessRequestsHeader } from './AccessRequestsHeader';
import { AccessRequestsFilters } from './AccessRequestsFilters';
import { AccessRequestsTable } from './AccessRequestsTable';

interface AccessRequestsTabProps {
  requests?: AccessRequest[];
}


export default function AccessRequestsTab({ requests }: AccessRequestsTabProps) {
  const [listState, dispatch] = useReducer(accessRequestListReducer, INITIAL_ACCESS_REQUEST_LIST_STATE);
  const { searchQuery, statusFilter, typeFilter, verificationFilter, eventFilter, reviewStageFilter, currentPage, pageSize, sortField, sortDirection, showAdvancedFilters } = listState;
  const setSearchQuery = (value: string) => dispatch({ type: 'change', field: 'searchQuery', value });
  const setStatusFilter = (value: StatusFilter) => dispatch({ type: 'change', field: 'statusFilter', value });
  const setTypeFilter = (value: TypeFilter) => dispatch({ type: 'change', field: 'typeFilter', value });
  const setVerificationFilter = (value: VerificationFilter) => dispatch({ type: 'change', field: 'verificationFilter', value });
  const setEventFilter = (value: string) => dispatch({ type: 'change', field: 'eventFilter', value: value === 'all_events' ? '' : value });
  const setReviewStageFilter = (value: string) => dispatch({ type: 'change', field: 'reviewStageFilter', value });
  const setCurrentPage = (page: number) => dispatch({ type: 'page', page });
  const setPageSize = (value: number) => dispatch({ type: 'page-size', pageSize: value });
  const setShowAdvancedFilters = () => dispatch({ type: 'toggle-advanced' });
  const [resendingId, setResendingId] = useState<string | null>(null);

  const [requestData, dispatchRequestData] = useReducer(accessRequestDataReducer, { items: requests ?? [], total: requests?.length ?? 0, summary: {}, reviewStageBuckets: [], nextCursor: null });
  const { items: localRequests, total: collectionTotal, summary, reviewStageBuckets, nextCursor } = requestData;
  const { toast, showToast, hideToast } = useToast();
  const latestListStateRef = useRef(listState);
  const requestControllerRef = useRef<AbortController | null>(null);
  const completedQueryRef = useRef('');

  useEffect(() => {
    latestListStateRef.current = listState;
  }, [listState]);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  // Polling for live updates
  const fetchRequests = useCallback(async () => {
    // usePolling permits one request at a time. If a user changes filters while
    // one is pending, finish only the latest query instead of publishing the old
    // cursor page over their new selection.
    const controller = new AbortController();
    requestControllerRef.current = controller;
    try {
      while (!controller.signal.aborted) {
        const requestedState = latestListStateRef.current;
        const params = requestQueryParams(requestedState);
        try {
          const response = await fetch(`/api/admin/requests?${params}`, { signal: controller.signal });
          if (!response.ok) {
            if (params.toString() !== requestQueryParams(latestListStateRef.current).toString()) continue;
            throw new Error('Failed to fetch requests');
          }
          const data = await response.json();
          if (params.toString() === requestQueryParams(latestListStateRef.current).toString()) {
            completedQueryRef.current = params.toString();
            return data;
          }
        } catch (error) {
          if (controller.signal.aborted) throw error;
          if (params.toString() !== requestQueryParams(latestListStateRef.current).toString()) continue;
          throw error;
        }
      }
      throw new DOMException('Access-request refresh was cancelled', 'AbortError');
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    }
  }, []);

  const { 
    isLoading: isPollingLoading, 
    isPolling, 
    togglePolling, 
    refresh,
    lastUpdated
  } = usePolling(fetchRequests, {
    interval: 30000,
    onSuccess: (data) => {
      dispatchRequestData({ type: 'loaded', data });
    }
  });

  useEffect(() => {
    let cancelled = false;
    const expectedQuery = requestQueryParams(listState).toString();
    void (async () => {
      await refresh();
      // A state update can arrive while usePolling is settling a previous
      // request. Ask once more only when that request did not fetch this state.
      if (!cancelled && completedQueryRef.current !== expectedQuery) await refresh();
    })();
    return () => { cancelled = true; };
  }, [listState, refresh]);

  // Update local state when prop changes (initial load or parent update)
  useEffect(() => {
    if (requests !== undefined) {
      dispatchRequestData({ type: 'initial', items: requests });
    }
  }, [requests]);

  // Extract unique events from requests
  const availableEvents = useMemo(() => {
    const eventSet = new Set<string>();

    localRequests.forEach(req => {
      if (req.event?.name) {
        eventSet.add(req.event.name);
      } else if (req.eventReason) {
        eventSet.add(req.eventReason);
      }
    });
    return Array.from(eventSet).sort();
  }, [localRequests]);

  const exportToCSV = () => {
    const params = requestQueryParams(listState, false);
    const download = document.createElement('a');
    download.href = `/api/admin/requests/export?${params}`;
    download.click();
  };

  // Filtering and ordering are authoritative on the server; this is the current cursor page only.
  const sortedRequests = localRequests;

  const totalPages = Math.max(1, Math.ceil(collectionTotal / pageSize));
  const paginatedRequests = sortedRequests;

  const handleSort = (field: typeof sortField) => dispatch({ type: 'sort', field });

  const totalRequests = collectionTotal;
  const pendingVerification = summary.pending_verification ?? 0;
  const approved = summary.approved ?? 0;

  const handleResendVerification = useCallback(async (requestId: string) => {
    try {
      setResendingId(requestId);
      // Dropdown closes automatically with Shadcn
      const response = await fetchWithCsrf(`/api/admin/requests/${requestId}/resend-verification`, {
        method: 'POST',
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const message = errorBody?.error || 'Failed to send verification email';
        showToast(message, 'error');
        return;
      }

      const data = await response.json().catch(() => null);
      showToast(data?.message || 'Verification email resent successfully', 'success');
    } catch (error) {
      console.error('Failed to resend verification email:', error);
      showToast('Failed to send verification email. Please try again.', 'error');
    } finally {
      setResendingId((current: string | null) => (current === requestId ? null : current));
    }
  }, [showToast]);

  const displayModel: AccessRequestsDisplayModel = { totalRequests, pendingVerification, approved, reviewStageBuckets, setReviewStageFilter, lastUpdated, isPolling, isPollingLoading, togglePolling, refresh, summary, collectionTotal, searchQuery, statusFilter, reviewStageFilter, typeFilter, verificationFilter, eventFilter, setSearchQuery, setStatusFilter, setTypeFilter, setVerificationFilter, setEventFilter, currentPage, setCurrentPage, setPageSize, setShowAdvancedFilters, showAdvancedFilters, exportToCSV, availableEvents, dispatch, sortedRequests, paginatedRequests, totalPages, pageSize, nextCursor, handleSort, sortField, sortDirection, getStatusBadge, resendingId, handleResendVerification, toast, hideToast };

  return <><AccessRequestsHeader model={displayModel} /><AccessRequestsFilters model={displayModel} /><AccessRequestsTable model={displayModel} /></>;
}
