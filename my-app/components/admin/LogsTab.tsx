'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePolling } from '@/hooks/usePolling';
import { LogDetailsDialog } from './LogDetailsDialog';
import { LogsFilters } from './LogsFilters';
import { buildLogsQuery, EMPTY_LOG_FILTERS, updateLogsFilters } from './LogsHelpers';
import { LogsSummary } from './LogsSummary';
import { LogsTable } from './LogsTable';
import type { AuditLog, LogFilters, LogsResponse } from './LogsTypes';
import ActionHistoryMonitoringTab from './ActionHistoryMonitoringTab';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface LogsTabProps { isLoading: boolean; initialView?: 'audit' | 'history'; }

export default function LogsTab({ isLoading: initialLoading, initialView = 'audit' }: LogsTabProps) {
  const [filters, setFilters] = useState<LogFilters>(EMPTY_LOG_FILTERS);
  const [debouncedTextFilters, setDebouncedTextFilters] = useState({ search: '', username: '' });
  const [currentPage, setCurrentPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [liveUpdates, setLiveUpdates] = useState(true);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedTextFilters({ search: filters.search, username: filters.username }), 300);
    return () => window.clearTimeout(timer);
  }, [filters.search, filters.username]);

  const queryFilters = useMemo(() => ({ ...filters, ...debouncedTextFilters }), [filters, debouncedTextFilters]);
  const query = useMemo(() => buildLogsQuery(queryFilters, currentPage, limit), [queryFilters, currentPage, limit]);
  const onFiltersChange = useCallback((nextFilters: LogFilters) => {
    const next = updateLogsFilters(filters, nextFilters, currentPage);
    setFilters(next.filters);
    setCurrentPage(next.page);
  }, [currentPage, filters]);
  const clearFilters = useCallback(() => {
    setDebouncedTextFilters({ search: '', username: '' });
    onFiltersChange(EMPTY_LOG_FILTERS);
  }, [onFiltersChange]);
  const changeLimit = useCallback((nextLimit: number) => { setLimit(nextLimit); setCurrentPage(1); }, []);

  return <Tabs defaultValue={initialView} className="gap-4">
    <TabsList aria-label="Activity view">
      <TabsTrigger value="audit">Audit stream</TabsTrigger>
      <TabsTrigger value="history">Account history</TabsTrigger>
    </TabsList>
    <TabsContent value="audit" className="space-y-4">
      <LogsFilters filters={filters} onFiltersChange={onFiltersChange} limit={limit} onLimitChange={changeLimit} onClear={clearFilters} />
      <LogsResults key={query} query={query} initialLoading={initialLoading} enabled={liveUpdates} onLiveUpdatesChange={setLiveUpdates} currentPage={currentPage} onPageChange={setCurrentPage} onSelectLog={setSelectedLog} />
      <LogDetailsDialog log={selectedLog} onOpenChange={(open) => { if (!open) setSelectedLog(null); }} />
    </TabsContent>
    <TabsContent value="history">
      <ActionHistoryMonitoringTab />
    </TabsContent>
  </Tabs>;
}

function LogsResults({ query, initialLoading, enabled, onLiveUpdatesChange, currentPage, onPageChange, onSelectLog }: {
  query: string;
  initialLoading: boolean;
  enabled: boolean;
  onLiveUpdatesChange: (enabled: boolean) => void;
  currentPage: number;
  onPageChange: (page: number) => void;
  onSelectLog: (log: AuditLog) => void;
}) {
  const fetchLogs = useCallback(async (): Promise<LogsResponse> => {
    const response = await fetch(`/api/admin/logs?${query}`);
    if (!response.ok) throw new Error('Unable to load audit logs.');
    return response.json() as Promise<LogsResponse>;
  }, [query]);
  const { data, error, isLoading, isPolling, togglePolling, refresh, lastUpdated } = usePolling(fetchLogs, { enabled });
  const logs = data?.logs ?? [];
  const pagination = data?.pagination ?? { page: currentPage, limit: 50, total: 0, totalPages: 1 };
  const loading = (initialLoading || isLoading) && !data && !error;

  return <>
    <LogsSummary error={error} lastUpdated={lastUpdated} isPolling={isPolling} isPollingLoading={isLoading} onTogglePolling={() => { togglePolling(); onLiveUpdatesChange(!isPolling); }} onRefresh={refresh} />
    {loading ? <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">Loading audit logs…</div> : !data && error ? null : <LogsTable logs={logs} totalLogs={pagination.total} currentPage={pagination.page} totalPages={pagination.totalPages} onPageChange={onPageChange} onSelectLog={onSelectLog} />}
  </>;
}
