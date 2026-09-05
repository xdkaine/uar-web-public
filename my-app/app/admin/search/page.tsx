'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useToast } from '@/hooks/useToast';
import RequestDetailModal from '@/components/admin/RequestDetailModal';
import { ClientLocalDate } from '@/components/admin/ClientLocalDate';
import { useAdminPageTracking } from '@/hooks/useAdminPageTracking';
import { useAdminNavigation } from '@/components/admin/AdminShell';
import {
  getAvailableAdminSearchTypes,
  type AdminSearchType,
} from '@/lib/rbac/search-access';
import {
  AlertTriangle,
  FileText,
  History,
  LifeBuoy,
  Loader2,
  Search,
  ShieldCheck,
  Wifi,
} from 'lucide-react';

const SEARCH_DEBOUNCE_MS = 350;

interface SearchResult {
  id: string;
  type: string;
  // Fields populated by /api/admin/search depending on result type
  name?: string;
  email?: string;
  username?: string | null;
  status?: string;
  isInternal?: boolean;
  event?: string;
  institution?: string;
  createdAt?: string;
  actionType?: string;
  targetAccountType?: string;
  targetUsername?: string;
  reason?: string;
  requestedBy?: string;
  relatedRequestId?: string | null;
  relatedTicketId?: string | null;
  completedAt?: string | null;
  fullName?: string;
  portalType?: string;
  expiresAt?: string | null;
  revokedReason?: string | null;
  ticketNumber?: string;
  subject?: string;
  category?: string;
  priority?: string;
  requesterName?: string;
  requesterEmail?: string;
  assignedTo?: string | null;
  action?: string;
  targetId?: string | null;
  targetType?: string | null;
  timestamp?: string;
  ipAddress?: string | null;
  review?: { workflow: { version: number; warning: string | null }; currentStage: { label: string } | null };
}

interface SearchResults {
  accessRequests: SearchResult[];
  lifecycleActions: SearchResult[];
  vpnAccounts: SearchResult[];
  supportTickets: SearchResult[];
  auditLogs: SearchResult[];
  totalResults: number;
  searchQuery: string;
  searchType: string;
}

const TYPE_OPTIONS: Array<{ value: AdminSearchType; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'requests', label: 'Requests' },
  { value: 'lifecycle', label: 'Lifecycle' },
  { value: 'vpn', label: 'VPN' },
  { value: 'tickets', label: 'Tickets' },
  { value: 'audit', label: 'Audit' },
];

function statusBadgeClass(status?: string): string {
  const map: Record<string, string> = {
    pending_verification: 'bg-muted text-foreground',
    pending_student_directors: 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200',
    pending_faculty: 'bg-yellow-100 dark:bg-yellow-950/60 text-yellow-800 dark:text-yellow-200',
    approved: 'bg-green-100 dark:bg-green-950/60 text-green-800 dark:text-green-200',
    rejected: 'bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-200',
    offboarded: 'bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 border border-slate-200 dark:border-slate-700',
    queued: 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200',
    processing: 'bg-yellow-100 dark:bg-yellow-950/60 text-yellow-800 dark:text-yellow-200',
    completed: 'bg-green-100 dark:bg-green-950/60 text-green-800 dark:text-green-200',
    failed: 'bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-200',
    cancelled: 'bg-border text-muted-foreground',
    active: 'bg-green-100 dark:bg-green-950/60 text-green-800 dark:text-green-200',
    revoked: 'bg-red-100 dark:bg-red-950/60 text-red-800 dark:text-red-200',
    expired: 'bg-muted text-foreground',
    open: 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200',
    in_progress: 'bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-200',
    closed: 'bg-muted text-foreground',
  };
  return map[status ?? ''] || 'bg-muted text-foreground';
}

function StatusBadge({ status, label }: { status?: string; label?: string }) {
  if (!status) return null;
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusBadgeClass(status)}`}>
      {(label || status.replace(/_/g, ' ')).toUpperCase()}
    </span>
  );
}

function typeIcon(type: string, className = 'h-4 w-4') {
  switch (type) {
    case 'lifecycle_action':
      return <History className={`${className} text-purple-500`} />;
    case 'vpn_account':
      return <Wifi className={`${className} text-green-500`} />;
    case 'support_ticket':
      return <LifeBuoy className={`${className} text-yellow-600 dark:text-yellow-400`} />;
    case 'audit_log':
      return <ShieldCheck className={`${className} text-muted-foreground`} />;
    default:
      return <FileText className={`${className} text-blue-500`} />;
  }
}

function resultTitle(item: SearchResult): string {
  if (item.type === 'support_ticket') return `#${item.ticketNumber} · ${item.subject}`;
  if (item.type === 'access_request') return item.name || item.id;
  if (item.type === 'lifecycle_action') return `${(item.actionType || '').replace(/_/g, ' ').toUpperCase()} — ${item.targetUsername}`;
  if (item.type === 'vpn_account') return item.username || item.id;
  return item.action || item.id;
}

function resultSubtitleParts(item: SearchResult): string[] {
  const values: Record<string, Array<string | undefined | null>> = {
    access_request: [item.email, item.username && `@${item.username}`, item.event],
    lifecycle_action: [item.reason, item.requestedBy && `by ${item.requestedBy}`],
    vpn_account: [item.fullName, item.email, item.portalType],
    support_ticket: [item.requesterName && `@${item.requesterName}`, item.category],
    audit_log: [item.username && `@${item.username}`, item.targetId, item.ipAddress],
  };
  return (values[item.type] ?? []).filter((value): value is string => Boolean(value));
}

function ResultRow({
  item,
  onOpen,
}: {
  item: SearchResult;
  onOpen?: () => void;
}) {
  const title = resultTitle(item);
  const subtitleParts = resultSubtitleParts(item);

  const when = item.timestamp || item.createdAt;

  const body = (
    <div className="group flex w-full items-center gap-3 rounded-lg border border-transparent px-3 py-2.5 transition-colors hover:border-border hover:bg-muted/40">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-muted/70">
        {typeIcon(item.type)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground" title={title}>
          {title}
        </p>
        {subtitleParts.length > 0 && (
          <p className="truncate text-xs text-muted-foreground">
            {subtitleParts.join(' · ')}
          </p>
        )}
      </div>
        <StatusBadge status={item.status} label={item.review?.currentStage?.label} />
      {when && (
        <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
          <ClientLocalDate value={when} format="date" />
        </span>
      )}
    </div>
  );

  if (onOpen) {
    return (
      <button type="button" onClick={onOpen} className="w-full text-left">
        {body}
      </button>
    );
  }
  return body;
}

export default function GlobalSearchPage() {
  const { showToast } = useToast();
  const navigation = useAdminNavigation();
  useAdminPageTracking('Admin Global Search', 'navigation');

  useEffect(() => {
    document.title = 'Global Search | User Access Request (UAR) Portal';
  }, []);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchType, setSearchType] = useState<AdminSearchType>('all');
  const [results, setResults] = useState<SearchResults | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const availableSearchTypes = useMemo(
    () => getAvailableAdminSearchTypes(navigation?.permissions ?? new Set<string>()),
    [navigation?.permissions]
  );
  const availableTypeOptions = useMemo(
    () => TYPE_OPTIONS.filter(
      (option) => option.value === 'all' || availableSearchTypes.includes(option.value)
    ),
    [availableSearchTypes]
  );
  const hasOperationalSearchGap = navigation?.state === 'ready' && availableSearchTypes.length === 0;

  useEffect(() => {
    if (searchType !== 'all' && !availableSearchTypes.includes(searchType)) {
      setSearchType('all');
    }
  }, [availableSearchTypes, searchType]);

  const runSearch = useCallback(
    async (query: string, type: AdminSearchType) => {
      const trimmed = query.trim();
      if (trimmed.length < 2) {
        setResults(null);
        setSearched(false);
        return;
      }

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setLoading(true);
      try {
        const res = await fetch(
          `/api/admin/search?q=${encodeURIComponent(trimmed)}&type=${type}`,
          { signal: controller.signal }
        );
        if (!res.ok) {
          const error = await res.json().catch(() => ({ error: 'Search failed' }));
          throw new Error(error.error || 'Search failed');
        }
        const data: SearchResults = await res.json();
        setResults(data);
        setSearched(true);
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        console.error('Search error:', error);
        showToast(error instanceof Error ? error.message : 'Search failed', 'error');
      } finally {
        setLoading((currentlyLoading) => (
          abortRef.current === controller ? false : currentlyLoading
        ));
      }
    },
    [showToast]
  );

  // Debounced live search: fires as the user types and when the filter changes.
  useEffect(() => {
    const handle = setTimeout(() => {
      void runSearch(searchQuery, searchType);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchQuery, searchType]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const groups = results
    ? ([
        { key: 'accessRequests', label: 'Access Requests', type: 'access_request', items: results.accessRequests },
        { key: 'supportTickets', label: 'Support Tickets', type: 'support_ticket', items: results.supportTickets },
        { key: 'lifecycleActions', label: 'Lifecycle Actions', type: 'lifecycle_action', items: results.lifecycleActions },
        { key: 'vpnAccounts', label: 'VPN Accounts', type: 'vpn_account', items: results.vpnAccounts },
        { key: 'auditLogs', label: 'Audit Logs', type: 'audit_log', items: results.auditLogs },
        ] as Array<{ key: keyof Pick<SearchResults, 'accessRequests' | 'lifecycleActions' | 'vpnAccounts' | 'supportTickets' | 'auditLogs'>; label: string; type: string; items: SearchResult[] }>)
        .filter((group) => group.items.length > 0)
    : [];

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-4xl">
        <div className="mb-6 space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Global Search</h1>
          <p className="text-sm text-muted-foreground">
            Find records in the operational areas available to your account.
          </p>
        </div>

        {hasOperationalSearchGap && (
          <div role="alert" className="mb-6 flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Search has no operational data coverage</p>
              <p className="mt-1 text-sm">
                Your account has Global Search access but none of the underlying Requests,
                Lifecycle, VPN, Tickets, or Audit privileges. An administrator must correct the
                privilege mapping before search can be used.
              </p>
            </div>
          </div>
        )}

        {/* Search card */}
        <div className="sticky top-0 z-10 -mx-2 mb-6 rounded-xl border border-border bg-card/95 p-4 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80">
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <label htmlFor="admin-global-search" className="mb-2 block text-sm font-medium text-foreground">
                Search admin records
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  id="admin-global-search"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Name, email, username, ticket or request ID…"
                  className="h-11 w-full rounded-lg border border-input bg-background pl-10 pr-4 text-base text-foreground placeholder:text-muted-foreground focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring"
                  disabled={hasOperationalSearchGap || navigation?.state !== 'ready'}
                />
                {loading && (
                  <Loader2 className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                )}
              </div>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {availableTypeOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setSearchType(option.value)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                  searchType === option.value
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {!searched && !loading && (
          <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
            <Search className="mx-auto mb-4 h-10 w-10 text-muted-foreground/50" />
            <h3 className="mb-1 text-lg font-semibold text-foreground">Start typing to search</h3>
            <p className="text-sm text-muted-foreground">
              Results appear automatically as you type — at least 2 characters.
            </p>
          </div>
        )}

        {searched && results && results.totalResults === 0 && !loading && (
          <div className="rounded-xl border border-dashed border-border bg-card p-12 text-center">
            <Search className="mx-auto mb-4 h-10 w-10 text-muted-foreground/50" />
            <h3 className="mb-1 text-lg font-semibold text-foreground">No results</h3>
            <p className="text-sm text-muted-foreground">
              Nothing matched &quot;{results.searchQuery}&quot;. Try a different term or widen the type filter.
            </p>
          </div>
        )}

        {results && results.totalResults > 0 && (
          <div className="space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              {groups.map((group) => (
                <span
                  key={group.key}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground"
                >
                  {typeIcon(group.type, 'h-3.5 w-3.5')}
                  {group.label}
                  <span className="font-bold text-foreground">{group.items.length}</span>
                </span>
              ))}
              <span className="ml-auto text-xs text-muted-foreground">
                {results.totalResults} total
              </span>
            </div>

            {groups.map((group) => (
              <section key={group.key}>
                <h2 className="mb-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {group.label}
                </h2>
                <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {group.items.map((item) => {
                    if (item.type === 'access_request') {
                      return (
                        <ResultRow
                          key={item.id}
                          item={item}
                          onOpen={() => setSelectedRequestId(item.id)}
                        />
                      );
                    }
                    if (item.type === 'support_ticket') {
                      return (
                        <Link key={item.id} href={`/admin/support/tickets/${item.id}`} className="block">
                          <ResultRow item={item} />
                        </Link>
                      );
                    }
                    if (item.type === 'lifecycle_action' || item.type === 'vpn_account') {
                      const tab = item.type === 'lifecycle_action' ? 'lifecycle' : 'vpn';
                      return (
                        <Link key={item.id} href={`/admin?tab=${tab}`} className="block">
                          <ResultRow item={item} />
                        </Link>
                      );
                    }
                    return <ResultRow key={item.id} item={item} />;
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>

      {selectedRequestId && (
        <RequestDetailModal
          requestId={selectedRequestId}
          onClose={() => setSelectedRequestId(null)}
        />
      )}
    </div>
  );
}
