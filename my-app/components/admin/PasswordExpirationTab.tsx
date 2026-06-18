'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchWithCsrf } from '@/lib/csrf';
import { useToast } from '@/hooks/useToast';
import Toast from '@/components/Toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  CheckCircle2,
  Clock,
  Download,
  Mail,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
} from 'lucide-react';

type PasswordExpirationStatus =
  | 'valid'
  | 'expiring_soon'
  | 'expired'
  | 'must_change'
  | 'never_expires'
  | 'unknown'
  | 'skipped';

interface PasswordExpirationRow {
  requestId: string | null;
  username: string;
  displayName: string;
  email: string;
  status: PasswordExpirationStatus;
  eligibleForNotification: boolean;
  skipReason: string | null;
  accountEnabled: boolean | null;
  passwordLastSet: string | null;
  passwordExpiresAt: string | null;
  daysRemaining: number | null;
  daysOverdue: number | null;
  reminderMilestone: number | 'expired' | 'must_change' | null;
  reminderKey: string | null;
  lastNotificationAt: string | null;
  lastNotificationStatus: string | null;
  policySource: string;
  detail: string;
}

interface PasswordExpirationReport {
  generatedAt: string;
  policy: {
    warningDays: number;
    maxPasswordAgeDays: number | null;
    policySource: string;
    milestones: number[];
  };
  summary: Record<PasswordExpirationStatus | 'total' | 'eligibleForNotification', number>;
  rows: PasswordExpirationRow[];
  recentLogs?: Array<{
    id: string;
    createdAt: string;
    action: string;
    username: string;
    subjectUsername: string | null;
    subjectEmail: string | null;
    outcome: string | null;
    success: boolean;
    errorMessage: string | null;
  }>;
}

type StatusFilter = PasswordExpirationStatus | 'all' | 'needs_action';
type SortField = 'status' | 'username' | 'displayName' | 'email' | 'passwordLastSet' | 'passwordExpiresAt' | 'days';

const ACTIONABLE_STATUSES: PasswordExpirationStatus[] = ['expiring_soon', 'expired', 'must_change'];

function formatStatus(status: PasswordExpirationStatus) {
  return status.replace(/_/g, ' ');
}

function formatDate(value: string | null) {
  if (!value) return 'N/A';
  return new Date(value).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusBadgeClass(status: PasswordExpirationStatus) {
  switch (status) {
    case 'expired':
    case 'must_change':
      return 'bg-red-100 text-red-800 border-red-200 hover:bg-red-100';
    case 'expiring_soon':
      return 'bg-amber-100 text-amber-800 border-amber-200 hover:bg-amber-100';
    case 'valid':
      return 'bg-green-100 text-green-800 border-green-200 hover:bg-green-100';
    case 'never_expires':
      return 'bg-slate-100 text-slate-700 border-slate-200 hover:bg-slate-100';
    case 'skipped':
      return 'bg-zinc-100 text-zinc-700 border-zinc-200 hover:bg-zinc-100';
    default:
      return 'bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100';
  }
}

function dueText(row: PasswordExpirationRow) {
  if (row.status === 'must_change') return 'Required now';
  if (row.daysOverdue !== null) return `${row.daysOverdue} day${row.daysOverdue === 1 ? '' : 's'} overdue`;
  if (row.daysRemaining !== null) return `${row.daysRemaining} day${row.daysRemaining === 1 ? '' : 's'} left`;
  return 'N/A';
}

function policyMaxAgeText(report: PasswordExpirationReport | null) {
  if (!report) return 'loading';
  if (report.policy.policySource === 'ad_unavailable') return 'AD policy unavailable';
  if (report.policy.maxPasswordAgeDays === null) return 'non-expiring';
  return `${report.policy.maxPasswordAgeDays} day max age`;
}

function policySourceText(source: string | undefined) {
  switch (source) {
    case 'ad_domain_policy':
      return 'Active Directory domain policy';
    case 'ad_computed':
      return 'Active Directory computed expiry';
    case 'ad_unavailable':
      return 'Active Directory policy unavailable';
    default:
      return 'loading';
  }
}

export default function PasswordExpirationTab() {
  const [report, setReport] = useState<PasswordExpirationReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('needs_action');
  const [sortField, setSortField] = useState<SortField>('days');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  const [selectedUsernames, setSelectedUsernames] = useState<string[]>([]);
  const { toast, showToast, hideToast } = useToast();

  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/admin/password-expiration');
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to fetch password expiration report');
      }
      setReport(data);
      setSelectedUsernames([]);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to fetch password expiration report', 'error');
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const filteredRows = useMemo(() => {
    const rows = report?.rows || [];
    const query = searchQuery.trim().toLowerCase();

    return rows.filter((row) => {
      const matchesQuery = !query || [
        row.username,
        row.displayName,
        row.email,
        row.detail,
        row.skipReason || '',
      ].some((value) => value.toLowerCase().includes(query));

      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'needs_action' && ACTIONABLE_STATUSES.includes(row.status)) ||
        row.status === statusFilter;

      return matchesQuery && matchesStatus;
    }).sort((left, right) => {
      let leftValue: string | number = '';
      let rightValue: string | number = '';

      if (sortField === 'days') {
        leftValue = left.daysOverdue !== null ? -left.daysOverdue : left.daysRemaining ?? Number.MAX_SAFE_INTEGER;
        rightValue = right.daysOverdue !== null ? -right.daysOverdue : right.daysRemaining ?? Number.MAX_SAFE_INTEGER;
      } else {
        leftValue = String(left[sortField] || '').toLowerCase();
        rightValue = String(right[sortField] || '').toLowerCase();
      }

      if (leftValue < rightValue) return sortDirection === 'asc' ? -1 : 1;
      if (leftValue > rightValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [report, searchQuery, statusFilter, sortField, sortDirection]);

  const selectedEligibleRows = useMemo(
    () => filteredRows.filter((row) => selectedUsernames.includes(row.username) && row.eligibleForNotification),
    [filteredRows, selectedUsernames]
  );

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const toggleSelection = (username: string, selected: boolean) => {
    setSelectedUsernames((current) => (
      selected
        ? Array.from(new Set([...current, username]))
        : current.filter((value) => value !== username)
    ));
  };

  const toggleAllVisible = (selected: boolean) => {
    if (!selected) {
      setSelectedUsernames([]);
      return;
    }

    setSelectedUsernames(filteredRows.filter((row) => row.eligibleForNotification).map((row) => row.username));
  };

  const sendReminders = async (
    mode: 'selected' | 'process',
    options?: { usernames?: string[]; force?: boolean }
  ) => {
    setIsSending(true);
    try {
      const url = mode === 'process'
        ? '/api/admin/password-expiration/process'
        : '/api/admin/password-expiration/notify';
      const body = mode === 'selected'
        ? {
          usernames: options?.usernames || selectedEligibleRows.map((row) => row.username),
          statuses: ACTIONABLE_STATUSES,
          force: options?.force === true,
        }
        : {};
      const response = await fetchWithCsrf(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to send password expiration reminders');
      }

      showToast(
        `Sent ${data.summary?.sent || 0}, skipped ${data.summary?.skipped || 0}, failed ${data.summary?.failed || 0}`,
        data.summary?.failed ? 'warning' : 'success'
      );
      await fetchReport();
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Failed to send password expiration reminders', 'error');
    } finally {
      setIsSending(false);
    }
  };

  const forceResendSelected = () => {
    if (selectedEligibleRows.length === 0) return;
    const confirmed = window.confirm(
      `Force resend password reminders to ${selectedEligibleRows.length} selected user${selectedEligibleRows.length === 1 ? '' : 's'}? This bypasses milestone deduplication.`
    );
    if (confirmed) {
      sendReminders('selected', { force: true });
    }
  };

  const exportCsv = () => {
    if (!report) return;
    const headers = [
      'Status',
      'Username',
      'Name',
      'Email',
      'Password Last Set',
      'Password Expires',
      'Days Remaining',
      'Days Overdue',
      'Eligible',
      'Last Notification',
      'Detail',
    ];
    const rows = filteredRows.map((row) => [
      row.status,
      row.username,
      row.displayName,
      row.email,
      row.passwordLastSet || '',
      row.passwordExpiresAt || '',
      row.daysRemaining ?? '',
      row.daysOverdue ?? '',
      row.eligibleForNotification ? 'yes' : 'no',
      row.lastNotificationAt || '',
      row.detail,
    ]);
    const csv = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `password_expiration_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const summaryCards = [
    { label: 'Needs Action', value: (report?.summary.expiring_soon || 0) + (report?.summary.expired || 0) + (report?.summary.must_change || 0), icon: ShieldAlert, className: 'text-red-700 bg-red-50 border-red-200' },
    { label: 'Expiring Soon', value: report?.summary.expiring_soon || 0, icon: Clock, className: 'text-amber-700 bg-amber-50 border-amber-200' },
    { label: 'Expired', value: (report?.summary.expired || 0) + (report?.summary.must_change || 0), icon: AlertTriangle, className: 'text-red-700 bg-red-50 border-red-200' },
    { label: 'Healthy', value: report?.summary.valid || 0, icon: CheckCircle2, className: 'text-green-700 bg-green-50 border-green-200' },
  ];

  return (
    <div className="space-y-5">
      <Toast {...toast} onClose={hideToast} />

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Password Expiration</h2>
          <p className="text-sm text-gray-600 mt-1">
            Active Directory password age monitoring for approved portal-managed accounts.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={fetchReport} disabled={isLoading} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button variant="outline" onClick={exportCsv} disabled={!report || filteredRows.length === 0} className="gap-2">
            <Download className="h-4 w-4" />
            Export
          </Button>
          <Button
            variant="secondary"
            onClick={() => sendReminders('process')}
            disabled={isSending}
            className="gap-2"
            title="Process unsent password reminder milestones"
          >
            <Send className="h-4 w-4" />
            Run Reminder Scan
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map(({ label, value, icon: Icon, className }) => (
          <Card key={label} className={`border ${className}`}>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide">{label}</p>
                <p className="text-2xl font-bold tabular-nums">{value}</p>
              </div>
              <Icon className="h-5 w-5" />
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <CardTitle className="text-base">
              Policy: {policyMaxAgeText(report)}, {report?.policy.warningDays || 14} day warning
              <span className="ml-2 text-xs font-normal text-gray-500">
                Source: {policySourceText(report?.policy.policySource)} · Milestones: {report?.policy.milestones?.join(', ') || 'N/A'} days
              </span>
            </CardTitle>
            <div className="text-xs text-gray-500">
              Last generated: {report ? formatDate(report.generatedAt) : 'N/A'}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
              <Input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search username, name, email, or detail..."
                className="pl-9"
              />
            </div>
            <div className="w-full xl:w-56">
              <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value as StatusFilter)}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="needs_action">Needs Action</SelectItem>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="expiring_soon">Expiring Soon</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                  <SelectItem value="must_change">Must Change</SelectItem>
                  <SelectItem value="valid">Valid</SelectItem>
                  <SelectItem value="never_expires">Never Expires</SelectItem>
                  <SelectItem value="unknown">Unknown</SelectItem>
                  <SelectItem value="skipped">Skipped</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => sendReminders('selected')}
              disabled={isSending || selectedEligibleRows.length === 0}
              className="gap-2 bg-gray-900 hover:bg-gray-800"
            >
              <Mail className="h-4 w-4" />
              Send Selected ({selectedEligibleRows.length})
            </Button>
            <Button
              variant="outline"
              onClick={forceResendSelected}
              disabled={isSending || selectedEligibleRows.length === 0}
              className="gap-2 text-red-700 border-red-200 hover:bg-red-50 hover:text-red-800"
            >
              <AlertTriangle className="h-4 w-4" />
              Force Resend
            </Button>
          </div>

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={filteredRows.length > 0 && selectedEligibleRows.length === filteredRows.filter((row) => row.eligibleForNotification).length}
                      onCheckedChange={(checked) => toggleAllVisible(Boolean(checked))}
                      aria-label="Select all eligible visible rows"
                    />
                  </TableHead>
                  <TableHead>
                    <button className="font-semibold" onClick={() => toggleSort('status')}>Status</button>
                  </TableHead>
                  <TableHead>
                    <button className="font-semibold" onClick={() => toggleSort('username')}>User</button>
                  </TableHead>
                  <TableHead>
                    <button className="font-semibold" onClick={() => toggleSort('email')}>Email</button>
                  </TableHead>
                  <TableHead>
                    <button className="font-semibold" onClick={() => toggleSort('passwordLastSet')}>Last Set</button>
                  </TableHead>
                  <TableHead>
                    <button className="font-semibold" onClick={() => toggleSort('passwordExpiresAt')}>Expires</button>
                  </TableHead>
                  <TableHead>
                    <button className="font-semibold" onClick={() => toggleSort('days')}>Due</button>
                  </TableHead>
                  <TableHead>Last Notice</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-24 text-center text-gray-500">
                      Loading password expiration report...
                    </TableCell>
                  </TableRow>
                ) : filteredRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-24 text-center text-gray-500">
                      No accounts match the current filters.
                    </TableCell>
                  </TableRow>
                ) : filteredRows.map((row) => (
                  <TableRow key={row.username}>
                    <TableCell>
                      <Checkbox
                        checked={selectedUsernames.includes(row.username)}
                        disabled={!row.eligibleForNotification}
                        onCheckedChange={(checked) => toggleSelection(row.username, Boolean(checked))}
                        aria-label={`Select ${row.username}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={`capitalize ${statusBadgeClass(row.status)}`}>
                        {formatStatus(row.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-gray-900">{row.username}</div>
                      <div className="text-xs text-gray-500">{row.displayName}</div>
                    </TableCell>
                    <TableCell>
                      <div className="max-w-[220px] truncate text-sm">{row.email || 'N/A'}</div>
                      {row.skipReason && (
                        <div className="text-xs text-red-600">{row.skipReason.replace(/_/g, ' ')}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-gray-700">{formatDate(row.passwordLastSet)}</TableCell>
                    <TableCell className="text-sm text-gray-700">{formatDate(row.passwordExpiresAt)}</TableCell>
                    <TableCell>
                      <div className="text-sm font-medium">{dueText(row)}</div>
                      <div className="text-xs text-gray-500 max-w-[220px] truncate" title={row.detail}>{row.detail}</div>
                    </TableCell>
                    <TableCell>
                      <div className="text-sm">{formatDate(row.lastNotificationAt)}</div>
                      {row.lastNotificationStatus && (
                        <div className="text-xs text-gray-500">{row.lastNotificationStatus}</div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={!row.eligibleForNotification || isSending}
                        onClick={() => {
                          sendReminders('selected', { usernames: [row.username] });
                        }}
                        className="gap-2"
                      >
                        <Mail className="h-4 w-4" />
                        Send
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {report?.recentLogs && report.recentLogs.length > 0 && (
            <div className="border-t pt-4">
              <Label className="text-sm font-semibold text-gray-700">Recent notification log</Label>
              <div className="mt-2 grid gap-2">
                {report.recentLogs.slice(0, 5).map((log) => (
                  <div key={log.id} className="flex flex-col gap-1 rounded-md border bg-gray-50 px-3 py-2 text-xs text-gray-700 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      <span className="font-semibold">{log.action.replace(/_/g, ' ')}</span>
                      {log.subjectUsername ? ` for ${log.subjectUsername}` : ''}
                      {log.outcome ? ` (${log.outcome})` : ''}
                    </span>
                    <span className="text-gray-500">{formatDate(log.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
