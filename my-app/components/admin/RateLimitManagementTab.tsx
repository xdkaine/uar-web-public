'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Toast from '@/components/Toast';
import { fetchWithCsrf } from '@/lib/csrf';
import { useToast } from '@/hooks/useToast';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertTriangle,
  Gauge,
  RefreshCw,
  Search,
  ShieldAlert,
  TimerReset,
  Unlock,
} from 'lucide-react';

type RateLimitStatus = 'tracking' | 'at_limit' | 'limited' | 'unknown';

interface RateLimitSession {
  id: string;
  key: string;
  storage: 'redis' | 'memory';
  scope: string;
  identifier: string | null;
  count: number;
  limit: number | null;
  remaining: number | null;
  reset: number | null;
  ttlSeconds: number | null;
  windowMs: number | null;
  updatedAt: number | null;
  status: RateLimitStatus;
}

interface RateLimitResponse {
  sessions?: RateLimitSession[];
  error?: string;
}

const statusLabels: Record<RateLimitStatus, string> = {
  tracking: 'Tracking',
  at_limit: 'At Limit',
  limited: 'Limited',
  unknown: 'Unknown',
};

function formatDuration(seconds: number | null): string {
  if (seconds === null) return 'Unknown';
  if (seconds <= 0) return 'Expired';

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${remainingSeconds}s`;
  return `${remainingSeconds}s`;
}

function formatWindow(windowMs: number | null): string {
  if (windowMs === null) return 'Unknown';
  return formatDuration(Math.ceil(windowMs / 1000));
}

function formatDate(timestamp: number | null): string {
  if (timestamp === null) return 'Unknown';
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getStatusBadgeClass(status: RateLimitStatus): string {
  const classes: Record<RateLimitStatus, string> = {
    limited: 'bg-red-100 dark:bg-red-950/60 text-red-800 border-red-200 dark:border-red-900',
    at_limit: 'bg-amber-100 dark:bg-amber-950/60 text-amber-800 border-amber-200 dark:border-amber-900',
    tracking: 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-200 border-green-200 dark:border-green-900',
    unknown: 'bg-muted text-muted-foreground border-border',
  };

  return classes[status];
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json() as RateLimitResponse;
    return data.error || fallback;
  } catch {
    return fallback;
  }
}

function useRateLimitManagement() {
  const [sessions, setSessions] = useState<RateLimitSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | RateLimitStatus>('all');
  const [storageFilter, setStorageFilter] = useState<'all' | 'redis' | 'memory'>('all');
  const [releaseTarget, setReleaseTarget] = useState<RateLimitSession | null>(null);
  const [isReleasing, setIsReleasing] = useState(false);
  const { toast, showToast, hideToast } = useToast();

  const fetchRateLimits = useCallback(async (showSpinner = true) => {
    if (showSpinner) {
      setIsRefreshing(true);
    }
    setError(null);

    try {
      const response = await fetch('/api/admin/ratelimits');
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to fetch rate limit sessions'));
      }

      const data = await response.json() as RateLimitResponse;
      setSessions(data.sessions || []);
    } catch (fetchError) {
      console.error('Error fetching rate limit sessions:', fetchError);
      setError(fetchError instanceof Error ? fetchError.message : 'Failed to load rate limit sessions');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => {
      fetchRateLimits(false);
    }, 0);
    const interval = window.setInterval(() => fetchRateLimits(false), 30000);

    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(interval);
    };
  }, [fetchRateLimits]);

  const filteredSessions = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();

    return sessions.filter((session) => {
      if (statusFilter !== 'all' && session.status !== statusFilter) return false;
      if (storageFilter !== 'all' && session.storage !== storageFilter) return false;
      if (!normalizedQuery) return true;

      return [
        session.key,
        session.scope,
        session.identifier || '',
        session.storage,
        statusLabels[session.status],
      ].some((value) => value.toLowerCase().includes(normalizedQuery));
    });
  }, [sessions, searchQuery, statusFilter, storageFilter]);

  const limitedCount = sessions.filter((session) => session.status === 'limited').length;
  const atLimitCount = sessions.filter((session) => session.status === 'at_limit').length;
  const trackingCount = sessions.filter((session) => session.status === 'tracking').length;

  const clearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
    setStorageFilter('all');
  };

  const handleRelease = async () => {
    if (!releaseTarget) return;

    setIsReleasing(true);
    try {
      const params = new URLSearchParams({ key: releaseTarget.key });
      const response = await fetchWithCsrf(`/api/admin/ratelimits?${params.toString()}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to release rate limit session'));
      }

      setSessions((currentSessions) => (
        currentSessions.filter((session) => session.key !== releaseTarget.key)
      ));
      showToast('Rate limit session released successfully', 'success');
      fetchRateLimits(false);
    } catch (releaseError) {
      console.error('Error releasing rate limit session:', releaseError);
      showToast(
        releaseError instanceof Error ? releaseError.message : 'Failed to release rate limit session',
        'error'
      );
    } finally {
      setIsReleasing(false);
      setReleaseTarget(null);
    }
  };

  return {
    clearFilters,
    error,
    fetchRateLimits,
    filteredSessions,
    handleRelease,
    hideToast,
    isLoading,
    isRefreshing,
    isReleasing,
    limitedCount,
    atLimitCount,
    releaseTarget,
    searchQuery,
    sessions,
    setReleaseTarget,
    setSearchQuery,
    setStatusFilter,
    setStorageFilter,
    statusFilter,
    storageFilter,
    toast,
    trackingCount,
  };
}

export default function RateLimitManagementTab() {
  const {
    clearFilters,
    error,
    fetchRateLimits,
    filteredSessions,
    handleRelease,
    hideToast,
    isLoading,
    isRefreshing,
    isReleasing,
    limitedCount,
    atLimitCount,
    releaseTarget,
    searchQuery,
    sessions,
    setReleaseTarget,
    setSearchQuery,
    setStatusFilter,
    setStorageFilter,
    statusFilter,
    storageFilter,
    toast,
    trackingCount,
  } = useRateLimitManagement();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Rate Limiting</h2>
          <p className="text-muted-foreground" aria-live="polite">
            {filteredSessions.length} visible of {sessions.length} active rate limit session{sessions.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Button onClick={() => fetchRateLimits(true)} disabled={isRefreshing} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-muted-foreground">Total Buckets</span>
            <Gauge className="h-4 w-4 text-slate-500" />
          </div>
          <p className="mt-2 text-2xl font-semibold">{sessions.length.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-muted-foreground">Limited</span>
            <ShieldAlert className="h-4 w-4 text-red-600 dark:text-red-400" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-red-700 dark:text-red-200">{limitedCount.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-muted-foreground">At Limit</span>
            <TimerReset className="h-4 w-4 text-amber-600 dark:text-amber-400" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-amber-700 dark:text-amber-200">{atLimitCount.toLocaleString()}</p>
        </div>
        <div className="rounded-lg border bg-card p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-muted-foreground">Tracking</span>
            <RefreshCw className="h-4 w-4 text-green-600 dark:text-green-400" />
          </div>
          <p className="mt-2 text-2xl font-semibold text-green-700 dark:text-green-200">{trackingCount.toLocaleString()}</p>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_180px_180px_auto] lg:items-end">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="rate-limit-search">Search</label>
            <div className="relative">
              <Input
                id="rate-limit-search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Scope, identifier, key..."
                className="pl-9"
              />
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="rate-limit-status">Status</label>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as 'all' | RateLimitStatus)}>
              <SelectTrigger id="rate-limit-status">
                <SelectValue placeholder="All Statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="limited">Limited</SelectItem>
                <SelectItem value="at_limit">At Limit</SelectItem>
                <SelectItem value="tracking">Tracking</SelectItem>
                <SelectItem value="unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="rate-limit-storage">Storage</label>
            <Select value={storageFilter} onValueChange={(value) => setStorageFilter(value as 'all' | 'redis' | 'memory')}>
              <SelectTrigger id="rate-limit-storage">
                <SelectValue placeholder="All Storage" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Storage</SelectItem>
                <SelectItem value="redis">Redis</SelectItem>
                <SelectItem value="memory">Memory</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button variant="outline" onClick={clearFilters} className="w-full lg:w-auto">
            Clear Filters
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="overflow-x-auto">
          <Table>
            <TableHeader className="bg-muted/50">
              <TableRow>
                <TableHead className="min-w-[260px]">Scope</TableHead>
                <TableHead className="min-w-[220px]">Identifier</TableHead>
                <TableHead>Requests</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Resets In</TableHead>
                <TableHead>Window</TableHead>
                <TableHead>Storage</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                Array.from({ length: 5 }).map((_, index) => (
                  <TableRow key={index}>
                    <TableCell><Skeleton className="h-10 w-full" /></TableCell>
                    <TableCell><Skeleton className="h-10 w-full" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-20" /></TableCell>
                    <TableCell><Skeleton className="h-8 w-20" /></TableCell>
                    <TableCell className="text-right"><Skeleton className="ml-auto h-8 w-24" /></TableCell>
                  </TableRow>
                ))
              ) : filteredSessions.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    No rate limit sessions found
                  </TableCell>
                </TableRow>
              ) : (
                filteredSessions.map((session) => (
                  <TableRow key={session.key}>
                    <TableCell className="align-top">
                      <div className="max-w-[360px] space-y-1">
                        <div className="break-all font-medium">{session.scope}</div>
                        <div className="break-all font-mono text-xs text-muted-foreground">{session.key}</div>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="max-w-[320px] break-all text-sm">
                        {session.identifier || <span className="text-muted-foreground">None</span>}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Last seen {formatDate(session.updatedAt)}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="font-medium">
                        {session.count.toLocaleString()}
                        {session.limit !== null && ` / ${session.limit.toLocaleString()}`}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {session.remaining === null ? 'Remaining unknown' : `${session.remaining.toLocaleString()} remaining`}
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge variant="outline" className={getStatusBadgeClass(session.status)}>
                        {statusLabels[session.status]}
                      </Badge>
                    </TableCell>
                    <TableCell className="align-top font-mono text-sm text-muted-foreground">
                      {formatDuration(session.ttlSeconds)}
                    </TableCell>
                    <TableCell className="align-top text-sm text-muted-foreground">
                      {formatWindow(session.windowMs)}
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge variant="secondary" className="capitalize">
                        {session.storage}
                      </Badge>
                    </TableCell>
                    <TableCell className="align-top text-right">
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => setReleaseTarget(session)}
                        className="gap-2"
                      >
                        <Unlock className="h-4 w-4" />
                        Release
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      <AlertDialog open={releaseTarget !== null} onOpenChange={(open) => !open && setReleaseTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release Rate Limit Session?</AlertDialogTitle>
            <AlertDialogDescription>
              This clears the selected rate limit bucket for {releaseTarget?.identifier || releaseTarget?.scope}. The next request will start a fresh window.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {releaseTarget && (
            <div className="rounded-md border bg-muted/50 p-3 text-sm">
              <div className="break-all font-medium">{releaseTarget.scope}</div>
              <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{releaseTarget.key}</div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isReleasing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                handleRelease();
              }}
              className="bg-red-600 text-white hover:bg-red-700"
              disabled={isReleasing}
            >
              {isReleasing ? 'Releasing...' : 'Release'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Toast
        message={toast.message}
        type={toast.type}
        isVisible={toast.isVisible}
        onClose={hideToast}
      />
    </div>
  );
}
