'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle } from 'lucide-react';
import type { ActionHistoryItem, ActionHistoryResponse } from '@/types/api';
import { ActionHistoryDetailDialog } from './ActionHistoryDetailDialog';
import { ActionHistoryResults } from './ActionHistoryResults';
import { ActionHistorySearchForm } from './ActionHistorySearchForm';

const eventKindOptions = ['all', 'write', 'security', 'notification', 'lifecycle', 'sync', 'system', 'read'];
const outcomeOptions = ['all', 'success', 'failure', 'denied', 'pending', 'rollback', 'skipped'];

export default function ActionHistoryMonitoringTab() {
  const [lookup, setLookup] = useState('');
  const [submittedLookup, setSubmittedLookup] = useState('');
  const [history, setHistory] = useState<ActionHistoryResponse | null>(null);
  const [selectedItem, setSelectedItem] = useState<ActionHistoryItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventKind, setEventKind] = useState('all');
  const [outcome, setOutcome] = useState('all');
  const [includeReads, setIncludeReads] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const activeRequestRef = useRef<symbol | null>(null);

  const canSearch = lookup.trim().length >= 2;
  const hasLookup = submittedLookup.trim().length >= 2;

  useEffect(() => {
    setPage(1);
  }, [submittedLookup, eventKind, outcome, includeReads, pageSize]);

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    if (!hasLookup) {
      setHistory(null);
      setError(null);
      return;
    }
    const params = new URLSearchParams({
      q: submittedLookup.trim(), includeReads: String(includeReads), eventKind, outcome,
      page: String(page), limit: String(pageSize),
    });
    const request = Symbol('action-history-request');
    activeRequestRef.current = request;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/action-history?${params.toString()}`, { signal });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load action history');
      }
      setHistory(await response.json());
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
      setError(loadError instanceof Error ? loadError.message : 'Failed to load action history');
    } finally {
      setIsLoading((currentlyLoading) => activeRequestRef.current === request ? false : currentlyLoading);
    }
  }, [eventKind, hasLookup, includeReads, outcome, page, pageSize, submittedLookup]);

  useEffect(() => {
    const controller = new AbortController();
    loadHistory(controller.signal);
    return () => controller.abort();
  }, [loadHistory, refreshNonce]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSearch) {
      setError('Enter at least 2 characters to look up an account, name, email, or request ID.');
      return;
    }
    setSubmittedLookup(lookup.trim());
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Account-centered history</h2>
        <p className="text-sm text-muted-foreground">Look up a person, account, request, or VPN record. Audit events and derived lifecycle milestones stay distinguishable in one timeline.</p>
      </div>
      <ActionHistorySearchForm lookup={lookup} eventKind={eventKind} outcome={outcome} includeReads={includeReads} canSearch={canSearch} hasLookup={hasLookup} isLoading={isLoading} eventKindOptions={eventKindOptions} outcomeOptions={outcomeOptions} onLookupChange={setLookup} onEventKindChange={setEventKind} onOutcomeChange={setOutcome} onIncludeReadsChange={setIncludeReads} onSubmit={handleSubmit} onRefresh={() => setRefreshNonce((current) => current + 1)} />
      {error && <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"><AlertCircle className="mt-0.5 h-4 w-4 flex-none" /><span>{error}</span></div>}
      {!hasLookup && !error && <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">Enter a lookup value to load a monitoring table.</div>}
      {hasLookup && <ActionHistoryResults history={history} isLoading={isLoading} submittedLookup={submittedLookup} pageSize={pageSize} onPageSizeChange={setPageSize} onPageChange={setPage} onItemSelect={setSelectedItem} />}
      <ActionHistoryDetailDialog item={selectedItem} onOpenChange={(open) => !open && setSelectedItem(null)} />
    </div>
  );
}
