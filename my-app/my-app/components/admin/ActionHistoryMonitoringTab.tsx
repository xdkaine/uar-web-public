'use client';

import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { AlertCircle, ChevronLeft, ChevronRight, Eye, Loader2, RefreshCw, Search } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ActionHistoryItem, ActionHistoryResponse } from '@/types/api';

const eventKindOptions = ['all', 'write', 'security', 'notification', 'lifecycle', 'sync', 'system', 'read'];
const outcomeOptions = ['all', 'success', 'failure', 'denied', 'pending', 'rollback', 'skipped'];

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

function badgeVariant(outcome: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (outcome === 'failure' || outcome === 'denied') return 'destructive';
  if (outcome === 'pending' || outcome === 'skipped') return 'secondary';
  if (outcome === 'rollback') return 'outline';
  return 'default';
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function compactText(value: string, maxLength = 220): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function subjectLabel(item: ActionHistoryItem): string {
  return item.subjectName || item.subjectUsername || item.subjectEmail || item.relatedRequestId || item.relatedVpnAccountId || 'Unknown';
}

function relatedLabel(item: ActionHistoryItem): string {
  if (item.relatedRequestId) return `Request ${item.relatedRequestId}`;
  if (item.relatedVpnAccountId) return `VPN ${item.relatedVpnAccountId}`;
  if (item.relatedLifecycleActionId) return `Lifecycle ${item.relatedLifecycleActionId}`;
  if (item.targetType && item.targetId) return `${item.targetType} ${item.targetId}`;
  return 'None';
}

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
  const [refreshNonce, setRefreshNonce] = useState(0);

  const canSearch = lookup.trim().length >= 2;
  const hasLookup = submittedLookup.trim().length >= 2;

  useEffect(() => {
    setPage(1);
  }, [submittedLookup, eventKind, outcome, includeReads]);

  const loadHistory = useCallback(async (signal?: AbortSignal) => {
    if (!hasLookup) {
      setHistory(null);
      setError(null);
      return;
    }

    const params = new URLSearchParams({
      q: submittedLookup.trim(),
      includeReads: String(includeReads),
      eventKind,
      outcome,
      page: String(page),
      limit: '25',
    });

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/action-history?${params.toString()}`, {
        signal,
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load action history');
      }

      setHistory(await response.json());
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === 'AbortError') return;
      setError(loadError instanceof Error ? loadError.message : 'Failed to load action history');
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }, [eventKind, hasLookup, includeReads, outcome, page, submittedLookup]);

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

  const canGoBack = (history?.page || 1) > 1;
  const canGoForward = history ? history.page < history.totalPages : false;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-xl font-semibold text-gray-900">Action History Monitoring</h2>
        <p className="text-sm text-gray-600">
          Look up a person or account by name, username, email, request ID, or VPN account ID.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="rounded-lg border border-gray-200 bg-gray-50 p-4">
        <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_180px_180px_auto] lg:items-end">
          <div className="space-y-2">
            <Label htmlFor="action-history-lookup">Lookup</Label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <Input
                id="action-history-lookup"
                value={lookup}
                onChange={(event) => setLookup(event.target.value)}
                className="pl-9"
                placeholder="Name, username, email, request ID, or VPN ID"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Event</Label>
            <Select value={eventKind} onValueChange={setEventKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {eventKindOptions.map((option) => (
                  <SelectItem key={option} value={option} className="capitalize">{option}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Outcome</Label>
            <Select value={outcome} onValueChange={setOutcome}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {outcomeOptions.map((option) => (
                  <SelectItem key={option} value={option} className="capitalize">{option}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Switch checked={includeReads} onCheckedChange={setIncludeReads} id="monitor-include-read-events" />
              <Label htmlFor="monitor-include-read-events" className="text-sm">Reads</Label>
            </div>
            <Button type="submit" disabled={!canSearch || isLoading}>
              {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              Search
            </Button>
            <Button type="button" variant="outline" disabled={!hasLookup || isLoading} onClick={() => setRefreshNonce((current) => current + 1)}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>
        </div>
      </form>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          <AlertCircle className="mt-0.5 h-4 w-4 flex-none" />
          <span>{error}</span>
        </div>
      )}

      {!hasLookup && !error && (
        <div className="rounded-md border border-dashed border-gray-300 p-8 text-center text-sm text-gray-500">
          Enter a lookup value to load a monitoring table.
        </div>
      )}

      {hasLookup && (
        <div className="rounded-md border border-gray-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 p-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Results for {submittedLookup}</h3>
              {history && <p className="text-xs text-gray-500">{history.total} matching event{history.total === 1 ? '' : 's'}</p>}
            </div>
          </div>

          <div className="overflow-x-auto">
            <Table className="table-fixed min-w-[1120px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">Time</TableHead>
                  <TableHead className="w-48">Subject</TableHead>
                  <TableHead className="w-[320px]">Action</TableHead>
                  <TableHead className="w-36">Actor</TableHead>
                  <TableHead className="w-36">IP</TableHead>
                  <TableHead className="w-28">Event</TableHead>
                  <TableHead className="w-48">Related</TableHead>
                  <TableHead className="w-16"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && !history ? (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-gray-500">
                      Loading action history...
                    </TableCell>
                  </TableRow>
                ) : history && history.items.length > 0 ? (
                  history.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="text-xs text-gray-600">{formatTimestamp(item.createdAt)}</TableCell>
                      <TableCell className="whitespace-normal">
                        <div className="space-y-0.5">
                          <div className="font-medium text-gray-900 wrap-break-word">{subjectLabel(item)}</div>
                          {item.subjectName && (item.subjectUsername || item.subjectEmail) && (
                            <div className="text-xs text-gray-500 wrap-break-word">
                              {[item.subjectUsername, item.subjectEmail].filter(Boolean).join(' / ')}
                            </div>
                          )}
                          {!item.subjectName && item.subjectUsername && item.subjectEmail && (
                            <div className="text-xs text-gray-500 wrap-break-word">{item.subjectEmail}</div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <div className="min-w-0 space-y-0.5">
                          <div className="font-medium text-gray-900 wrap-break-word">{compactText(item.title, 120)}</div>
                          {item.description && (
                            <div className="line-clamp-2 text-xs text-gray-500 wrap-break-word" title={item.description}>
                              {compactText(item.description)}
                            </div>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="whitespace-normal">
                        <div className="text-sm text-gray-900 wrap-break-word">{item.actor}</div>
                        <div className="text-xs text-gray-500 capitalize">{item.actorType}</div>
                      </TableCell>
                      <TableCell className="text-xs text-gray-600 whitespace-normal wrap-break-word">
                        {item.ipAddress || <span className="text-gray-400">None</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-1">
                          <Badge variant="outline" className="w-fit capitalize">{item.eventKind}</Badge>
                          <Badge variant={badgeVariant(item.outcome)} className="w-fit capitalize">{item.outcome}</Badge>
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-gray-600 whitespace-normal wrap-break-word">{relatedLabel(item)}</TableCell>
                      <TableCell>
                        <Button type="button" variant="ghost" size="sm" onClick={() => setSelectedItem(item)}>
                          <Eye className="h-4 w-4" />
                          <span className="sr-only">View details</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="h-24 text-center text-gray-500">
                      No history events matched this lookup.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>

          {history && history.totalPages > 1 && (
            <div className="flex items-center justify-between gap-3 border-t border-gray-200 p-4">
              <Button type="button" variant="outline" size="sm" disabled={!canGoBack || isLoading} onClick={() => setPage((current) => Math.max(1, current - 1))}>
                <ChevronLeft className="h-4 w-4" />
                Previous
              </Button>
              <span className="text-xs text-gray-500">Page {history.page} of {history.totalPages}</span>
              <Button type="button" variant="outline" size="sm" disabled={!canGoForward || isLoading} onClick={() => setPage((current) => current + 1)}>
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      <Dialog open={Boolean(selectedItem)} onOpenChange={(open) => !open && setSelectedItem(null)}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="wrap-break-word">{selectedItem?.title || 'Action History Details'}</DialogTitle>
          </DialogHeader>
          {selectedItem && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs text-gray-500">Time</Label>
                  <p className="text-sm text-gray-900">{formatTimestamp(selectedItem.createdAt)}</p>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Source</Label>
                  <p className="text-sm text-gray-900">{selectedItem.source}</p>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Actor</Label>
                  <p className="text-sm text-gray-900">{selectedItem.actor} ({selectedItem.actorType})</p>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">Subject</Label>
                  <p className="text-sm text-gray-900 wrap-break-word">{subjectLabel(selectedItem)}</p>
                </div>
                <div>
                  <Label className="text-xs text-gray-500">IP Address</Label>
                  <p className="text-sm text-gray-900 wrap-break-word">{selectedItem.ipAddress || 'None'}</p>
                </div>
                {selectedItem.userAgent && (
                  <div className="sm:col-span-2">
                    <Label className="text-xs text-gray-500">User Agent</Label>
                    <p className="text-xs text-gray-900 wrap-break-word">{selectedItem.userAgent}</p>
                  </div>
                )}
              </div>
              {selectedItem.description && (
                <p className="rounded border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 whitespace-pre-wrap wrap-break-word">
                  {selectedItem.description}
                </p>
              )}
              {selectedItem.details && Object.keys(selectedItem.details).length > 0 && (
                <dl className="grid gap-2 text-xs sm:grid-cols-2">
                  {Object.entries(selectedItem.details).map(([key, value]) => (
                    <div key={key} className="rounded border border-gray-200 bg-gray-50 p-2">
                      <dt className="font-medium text-gray-500">{key}</dt>
                      <dd className="mt-1 max-h-40 overflow-y-auto font-mono text-[11px] text-gray-900 whitespace-pre-wrap wrap-break-word">{formatValue(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}