'use client';

import { useEffect, useMemo, useState } from 'react';
import { fetchWithCsrf } from '@/lib/csrf';
import {
  getMinimumOffboardExtensionReminderDate,
  OFFBOARD_EXTENSION_REMINDER_MIN_LEAD_HOURS,
} from '@/lib/offboard-extension-schedule';
import DateTimePicker from '@/components/DateTimePicker';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  AlertTriangle,
  ArrowUpDown,
  Ban,
  CalendarClock,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Download,
  Info,
  ListChecks,
  Mail,
  Minus,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';

interface SelectableCampaignAccount {
  dn?: string;
  username: string;
  displayName: string;
  email: string;
  accountEnabled: boolean;
  whenCreated: string;
  lastVerifiedAt?: string | null;
  lastVerifiedSource?: string | null;
  originalRegistrationAt?: string | null;
}

interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  activatedAt: string | null;
  createdBy: string;
  totalRecipients: number;
  eligibleRecipients: number;
  skippedRecipients: number;
  sentCount: number;
  reminder3Count: number;
  reminder6Count: number;
  verifiedCount: number;
  enforcedCount: number;
  failedCount: number;
  rollbackState: string;
  emergencyStoppedAt: string | null;
  cancelledAt: string | null;
  sendingPaused: boolean;
  remindersPaused: boolean;
  enforcementPaused: boolean;
  currentWave: number;
}

interface CampaignRecipient {
  id: string;
  adUsername: string;
  email: string;
  displayName: string | null;
  linkedVpnUsername: string | null;
  lastVerifiedAt?: string | null;
  lastVerifiedSource?: string | null;
  originalRegistrationAt?: string | null;
  waveNumber: number;
  status: string;
  skipReason: string | null;
  projectedAction: string | null;
  initialEmailSentAt: string | null;
  deadlineAt: string | null;
  verifiedAt: string | null;
  enforcedAt: string | null;
  lastError: string | null;
  latestExtension?: {
    id: string;
    status: string;
    newDeadlineAt: string;
    notificationError: string | null;
  } | null;
}

interface CampaignLog {
  id: string;
  createdAt: string;
  level: string;
  eventType: string;
  actor: string | null;
  message: string;
}

interface CampaignDetail extends CampaignSummary {
  waveSize: number;
  canarySize: number;
  pauseAfterEachWave: boolean;
  sendingCompletedAt: string | null;
  recipients: CampaignRecipient[];
  logs: CampaignLog[];
  statusCounts?: Record<string, number>;
}

interface RollbackPreview {
  total: number;
  rollbackable: number;
  conflicts: number;
  items: Array<{
    recipientId: string;
    adUsername: string;
    linkedVpnUsername: string | null;
    actions: string[];
    conflicts: string[];
    rollbackable: boolean;
  }>;
}

interface ProcessAllPreview {
  campaignId: string;
  campaignStatus: string;
  runnable: boolean;
  sections: {
    initialEmails: { count: number; paused: boolean; description: string };
    reminders: {
      count: number;
      day3: number;
      day6: number;
      extension: number;
      suppressedExtension: number;
      paused: boolean;
      description: string;
    };
    enforcement: {
      count: number;
      adDisables: number;
      vpnRevocations: number;
      paused: boolean;
      description: string;
    };
  };
  statusCounts: Record<string, number>;
}

interface ExtensionPreviewItem {
  recipientId: string;
  adUsername: string;
  status: string;
  currentDeadline: string | null;
  newDeadline: string;
  eligible: boolean;
  reactivationRequired: boolean;
  actions: string[];
  conflicts: string[];
  excludedReason: string | null;
}

interface ExtensionPreview {
  campaignId: string;
  newDeadline: string;
  reminderDates: string[];
  total: number;
  eligible: number;
  sent: number;
  enforced: number;
  excluded: number;
  items: ExtensionPreviewItem[];
}

type SortDirection = 'asc' | 'desc';
type SortState<T extends string> = { key: T; direction: SortDirection };

interface OffboardCampaignsPanelProps {
  accounts?: SelectableCampaignAccount[];
  accountsLoading?: boolean;
}

function splitLines(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

function compareValues(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') {
    return a - b;
  }

  const aDate = typeof a === 'string' && a ? Date.parse(a) : Number.NaN;
  const bDate = typeof b === 'string' && b ? Date.parse(b) : Number.NaN;
  if (Number.isFinite(aDate) && Number.isFinite(bDate)) {
    return aDate - bDate;
  }

  return String(a ?? '').localeCompare(String(b ?? ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });
}

function sortedBy<T, K extends string>(
  items: T[],
  sort: SortState<K>,
  getValue: (item: T, key: K) => unknown
): T[] {
  return [...items].sort((a, b) => {
    const result = compareValues(getValue(a, sort.key), getValue(b, sort.key));
    return sort.direction === 'asc' ? result : -result;
  });
}

function nextSort<T extends string>(current: SortState<T>, key: T): SortState<T> {
  if (current.key === key) {
    return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
  }
  return { key, direction: 'asc' };
}

function SortHead<T extends string>({
  label,
  sortKey,
  sort,
  onSort,
  className,
}: {
  label: string;
  sortKey: T;
  sort: SortState<T>;
  onSort: (key: T) => void;
  className?: string;
}) {
  const active = sort.key === sortKey;
  return (
    <TableHead className={className}>
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="inline-flex min-h-9 items-center gap-1 text-left font-medium hover:text-foreground"
      >
        {label}
        <ArrowUpDown className={`h-3.5 w-3.5 ${active ? 'text-foreground' : 'text-muted-foreground'}`} />
      </button>
    </TableHead>
  );
}

function InfoTip({ label, children }: { label: string; children: React.ReactNode }) {
  const id = `offboard-tip-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <span className="group relative inline-flex">
      <button
        type="button"
        aria-describedby={id}
        aria-label={`${label} information`}
        className="inline-flex h-7 items-center gap-1 rounded-full border bg-background px-2 text-xs font-medium text-muted-foreground transition-colors hover:border-blue-300 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
      >
        <Info className="h-3.5 w-3.5" />
        {label}
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute left-0 top-full z-50 mt-2 hidden w-72 rounded-lg border border-slate-700 bg-slate-950 p-3 text-left text-xs font-normal leading-5 text-slate-100 shadow-xl group-hover:block group-focus-within:block"
      >
        {children}
      </span>
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (['active', 'sent', 'verified', 'enforced', 'completed', 'rolled_back', 'info'].includes(status)) {
    return <Badge className="bg-green-100 text-green-800 hover:bg-green-100">{status.replaceAll('_', ' ')}</Badge>;
  }
  if (['skipped', 'enforcement_skipped', 'dry_run', 'warn'].includes(status)) {
    return <Badge variant="secondary">{status.replaceAll('_', ' ')}</Badge>;
  }
  if (['cancelled', 'emergency_stopped', 'email_unknown', 'enforcement_failed', 'rollback_failed', 'error'].includes(status)) {
    return <Badge variant="destructive">{status.replaceAll('_', ' ')}</Badge>;
  }
  return <Badge variant="outline">{status.replaceAll('_', ' ')}</Badge>;
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : '-';
}

function formatLastVerified(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString() : 'N/A';
}

function verificationSourceLabel(source: string | null | undefined) {
  switch (source) {
    case 'current_campaign':
      return 'current campaign';
    case 'offboard_campaign':
      return 'campaign';
    case 'registration_verified':
      return 'registration verified';
    case 'registration':
      return 'registration';
    default:
      return 'no record';
  }
}

export default function OffboardCampaignsPanel({ accounts = [], accountsLoading = false }: OffboardCampaignsPanelProps) {
  const [isOpen, setIsOpen] = useState(true);
  const [activeTab, setActiveTab] = useState('campaigns');
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([]);
  const [selectedCampaign, setSelectedCampaign] = useState<CampaignDetail | null>(null);
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [rollbackPreview, setRollbackPreview] = useState<RollbackPreview | null>(null);
  const [campaignSort, setCampaignSort] = useState<SortState<'name' | 'status' | 'createdAt' | 'eligibleRecipients' | 'sentCount' | 'verifiedCount' | 'enforcedCount'>>({ key: 'createdAt', direction: 'desc' });
  const [recipientSort, setRecipientSort] = useState<SortState<'adUsername' | 'email' | 'linkedVpnUsername' | 'lastVerifiedAt' | 'waveNumber' | 'status' | 'deadlineAt' | 'issue'>>({ key: 'waveNumber', direction: 'asc' });
  const [logSort, setLogSort] = useState<SortState<'createdAt' | 'level' | 'eventType' | 'actor' | 'message'>>({ key: 'createdAt', direction: 'desc' });
  const [rollbackSort, setRollbackSort] = useState<SortState<'adUsername' | 'actions' | 'conflicts' | 'rollbackable'>>({ key: 'adUsername', direction: 'asc' });
  const [targetSort, setTargetSort] = useState<SortState<'username' | 'email' | 'lastVerifiedAt' | 'accountEnabled'>>({ key: 'username', direction: 'asc' });
  const [accountSearch, setAccountSearch] = useState('');
  const [selectedUsernames, setSelectedUsernames] = useState<Set<string>>(new Set());
  const [selectedRecipientIds, setSelectedRecipientIds] = useState<Set<string>>(new Set());
  const [processAllOpen, setProcessAllOpen] = useState(false);
  const [processAllPreview, setProcessAllPreview] = useState<ProcessAllPreview | null>(null);
  const [processAllSelection, setProcessAllSelection] = useState({
    initialEmails: true,
    reminders: true,
    enforcement: true,
    overrideSendingPause: false,
    overrideRemindersPause: false,
    overrideEnforcementPause: false,
  });
  const [extensionOpen, setExtensionOpen] = useState(false);
  const [extensionPreview, setExtensionPreview] = useState<ExtensionPreview | null>(null);
  const [extensionRecipientIds, setExtensionRecipientIds] = useState<string[] | null>(null);
  const [extensionForm, setExtensionForm] = useState({
    newDeadline: '',
    reminderDates: [] as string[],
    note: '',
  });
  const minimumExtensionReminderDate = getMinimumOffboardExtensionReminderDate();
  const [logs, setLogs] = useState<CampaignLog[]>([]);
  const [logPage, setLogPage] = useState(1);
  const [logPageSize, setLogPageSize] = useState(25);
  const [logTotalCount, setLogTotalCount] = useState(0);
  const [logTotalPages, setLogTotalPages] = useState(1);
  const [form, setForm] = useState({
    name: '',
    waveSize: 25,
    canarySize: 0,
    pauseAfterEachWave: true,
    includedUsernames: '',
    excludedUsernames: '',
    excludedEmails: '',
  });

  const targetUsernames = useMemo(() => {
    const manualUsernames = splitLines(form.includedUsernames).map(normalizeUsername);
    return Array.from(new Set([...selectedUsernames, ...manualUsernames])).filter(Boolean);
  }, [form.includedUsernames, selectedUsernames]);

  const selectableAccounts = useMemo(() => (
    accounts
      .filter(account => account.username && account.dn)
  ), [accounts]);

  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLowerCase();
    if (!query) return selectableAccounts;

    return selectableAccounts.filter(account => (
      account.username.toLowerCase().includes(query) ||
      (account.displayName || '').toLowerCase().includes(query) ||
      (account.email || '').toLowerCase().includes(query)
    ));
  }, [accountSearch, selectableAccounts]);

  const sortedTargetAccounts = useMemo(() => (
    sortedBy(filteredAccounts, targetSort, (account, key) => account[key])
  ), [filteredAccounts, targetSort]);

  const visibleSelectableAccounts = useMemo(() => (
    sortedTargetAccounts.filter(account => account.accountEnabled)
  ), [sortedTargetAccounts]);

  const allVisibleSelected = visibleSelectableAccounts.length > 0 &&
    visibleSelectableAccounts.every(account => selectedUsernames.has(normalizeUsername(account.username)));

  const sortedCampaigns = useMemo(() => (
    sortedBy(campaigns, campaignSort, (campaign, key) => campaign[key])
  ), [campaigns, campaignSort]);

  const sortedRecipients = useMemo(() => {
    if (!selectedCampaign) return [];
    return sortedBy(selectedCampaign.recipients, recipientSort, (recipient, key) => {
      if (key === 'issue') return recipient.skipReason || recipient.lastError || recipient.projectedAction || '';
      return recipient[key];
    });
  }, [selectedCampaign, recipientSort]);

  const sortedRollbackItems = useMemo(() => {
    if (!rollbackPreview) return [];
    return sortedBy(rollbackPreview.items, rollbackSort, (item, key) => {
      if (key === 'actions') return item.actions.join(', ');
      if (key === 'conflicts') return item.conflicts.join('; ');
      if (key === 'rollbackable') return item.rollbackable ? 1 : 0;
      return item[key];
    });
  }, [rollbackPreview, rollbackSort]);

  const stats = useMemo(() => {
    if (!selectedCampaign) return [];
    return [
      ['Eligible', selectedCampaign.eligibleRecipients],
      ['Skipped', selectedCampaign.skippedRecipients],
      ['Sent', selectedCampaign.sentCount],
      ['Verified', selectedCampaign.verifiedCount],
      ['Enforced', selectedCampaign.enforcedCount],
      ['Failures', selectedCampaign.failedCount],
    ];
  }, [selectedCampaign]);

  const fetchCampaigns = async (campaignId = selectedCampaignId) => {
    setIsLoading(true);
    try {
      const url = campaignId
        ? `/api/admin/offboard-campaigns?id=${encodeURIComponent(campaignId)}`
        : '/api/admin/offboard-campaigns';
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to load offboard campaigns');
      const data = await response.json();
      setCampaigns(data.campaigns || []);
      setSelectedCampaign(data.selectedCampaign || null);
      setSelectedCampaignId(data.selectedCampaign?.id || data.campaigns?.[0]?.id || null);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to load campaigns' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCampaigns(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchLogs = async () => {
    if (!selectedCampaignId) {
      setLogs([]);
      setLogTotalCount(0);
      setLogTotalPages(1);
      return;
    }

    try {
      const params = new URLSearchParams({
        page: String(logPage),
        pageSize: String(logPageSize),
        sortKey: logSort.key,
        sortDirection: logSort.direction,
      });
      const response = await fetch(`/api/admin/offboard-campaigns/${selectedCampaignId}/logs?${params}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load campaign logs');
      setLogs(data.logs || []);
      setLogPage(data.pagination?.page || 1);
      setLogTotalCount(data.pagination?.totalCount || 0);
      setLogTotalPages(data.pagination?.totalPages || 1);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to load campaign logs' });
    }
  };

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCampaignId, logPage, logPageSize, logSort.key, logSort.direction]);

  useEffect(() => {
    setSelectedRecipientIds(new Set());
    setExtensionPreview(null);
    setLogPage(1);
  }, [selectedCampaignId]);

  const runAction = async (label: string, fn: () => Promise<Response>, nextCampaignId?: string | null) => {
    setIsWorking(true);
    setMessage(null);
    try {
      const response = await fn();
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || `${label} failed`);
      setMessage({ type: 'success', text: data.message || `${label} completed` });
      await fetchCampaigns(nextCampaignId === undefined ? data.campaign?.id || selectedCampaignId : nextCampaignId);
      return true;
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : `${label} failed` });
      return false;
    } finally {
      setIsWorking(false);
    }
  };

  const toggleAccountSelection = (username: string, checked: boolean | 'indeterminate') => {
    const normalizedUsername = normalizeUsername(username);
    setSelectedUsernames(previous => {
      const next = new Set(previous);
      if (checked) {
        next.add(normalizedUsername);
      } else {
        next.delete(normalizedUsername);
      }
      return next;
    });
  };

  const selectVisibleAccounts = () => {
    setSelectedUsernames(previous => {
      const next = new Set(previous);
      visibleSelectableAccounts.forEach(account => next.add(normalizeUsername(account.username)));
      return next;
    });
  };

  const deselectVisibleAccounts = () => {
    setSelectedUsernames(previous => {
      const next = new Set(previous);
      visibleSelectableAccounts.forEach(account => next.delete(normalizeUsername(account.username)));
      return next;
    });
  };

  const clearSelectedAccounts = () => {
    setSelectedUsernames(new Set());
    setForm(previous => ({ ...previous, includedUsernames: '' }));
  };

  const createDryRun = async () => {
    if (targetUsernames.length === 0) {
      setMessage({ type: 'error', text: 'Select at least one account before creating a dry run' });
      setActiveTab('dry-run');
      return;
    }

    await runAction('Dry run', () =>
      fetchWithCsrf('/api/admin/offboard-campaigns/dry-run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          includedUsernames: targetUsernames,
          excludedUsernames: splitLines(form.excludedUsernames),
          excludedEmails: splitLines(form.excludedEmails),
        }),
      })
    );
    setActiveTab('campaigns');
  };

  const activateCampaign = async () => {
    if (!selectedCampaign) return;
    if (!window.confirm('Activate this offboard campaign and begin wave sending?')) return;
    await runAction('Activate campaign', () =>
      fetchWithCsrf(`/api/admin/offboard-campaigns/${selectedCampaign.id}/activate`, { method: 'POST' })
    );
  };

  const deleteDryRun = async (campaign: CampaignSummary) => {
    if (!window.confirm(`Delete dry run "${campaign.name}"? This removes the snapshot and cannot be undone.`)) return;
    await runAction('Delete dry run', () =>
      fetchWithCsrf(`/api/admin/offboard-campaigns/${campaign.id}`, { method: 'DELETE' }),
      selectedCampaignId === campaign.id ? null : selectedCampaignId
    );
  };

  const controlCampaign = async (action: string) => {
    if (!selectedCampaign) return;
    const destructive = action === 'cancel' || action === 'emergency_stop';
    if (destructive && !window.confirm(`Confirm ${action.replaceAll('_', ' ')} for this campaign.`)) return;
    await runAction(action.replaceAll('_', ' '), () =>
      fetchWithCsrf(`/api/admin/offboard-campaigns/${selectedCampaign.id}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
    );
  };

  const openProcessAll = async () => {
    if (!selectedCampaign) return;
    setIsWorking(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/admin/offboard-campaigns/${selectedCampaign.id}/process-all`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to preview Process All');
      const preview = data.preview as ProcessAllPreview;
      setProcessAllPreview(preview);
      setProcessAllSelection({
        initialEmails: preview.sections.initialEmails.count > 0,
        reminders: preview.sections.reminders.count > 0,
        enforcement: preview.sections.enforcement.count > 0,
        overrideSendingPause: false,
        overrideRemindersPause: false,
        overrideEnforcementPause: false,
      });
      setProcessAllOpen(true);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to preview Process All' });
    } finally {
      setIsWorking(false);
    }
  };

  const executeProcessAll = async () => {
    if (!selectedCampaign) return;
    const succeeded = await runAction('Process All', () =>
      fetchWithCsrf(`/api/admin/offboard-campaigns/${selectedCampaign.id}/process-all`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(processAllSelection),
      })
    );
    if (succeeded) {
      setProcessAllOpen(false);
      await fetchLogs();
    }
  };

  const extensionPayload = () => {
    if (!extensionForm.newDeadline) {
      throw new Error('Choose a new deadline');
    }
    return {
      ...(extensionRecipientIds ? { recipientIds: extensionRecipientIds } : {}),
      newDeadline: new Date(extensionForm.newDeadline).toISOString(),
      reminderDates: extensionForm.reminderDates
        .filter(Boolean)
        .map(value => new Date(value).toISOString()),
      note: extensionForm.note,
    };
  };

  const openExtension = (recipientIds: string[] | null) => {
    setExtensionRecipientIds(recipientIds);
    setExtensionPreview(null);
    setExtensionForm({ newDeadline: '', reminderDates: [], note: '' });
    setExtensionOpen(true);
  };

  const previewExtension = async () => {
    if (!selectedCampaign) return;
    setIsWorking(true);
    setMessage(null);
    try {
      const response = await fetchWithCsrf(`/api/admin/offboard-campaigns/${selectedCampaign.id}/extensions/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extensionPayload()),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Deadline extension preview failed');
      setExtensionPreview(data.preview);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Deadline extension preview failed' });
    } finally {
      setIsWorking(false);
    }
  };

  const executeExtension = async () => {
    if (!selectedCampaign || !extensionPreview?.eligible) return;
    const succeeded = await runAction('Deadline extension', () =>
      fetchWithCsrf(`/api/admin/offboard-campaigns/${selectedCampaign.id}/extensions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(extensionPayload()),
      })
    );
    if (succeeded) {
      setExtensionOpen(false);
      setExtensionPreview(null);
      setSelectedRecipientIds(new Set());
      await fetchLogs();
    }
  };

  const retryExtensionNotification = async (extensionId: string) => {
    if (!selectedCampaign) return;
    const succeeded = await runAction('Retry extension notification', () =>
      fetchWithCsrf(`/api/admin/offboard-campaigns/${selectedCampaign.id}/extensions/${extensionId}/retry`, {
        method: 'POST',
      })
    );
    if (succeeded) await fetchLogs();
  };

  const loadRollbackPreview = async () => {
    if (!selectedCampaign) return;
    setIsWorking(true);
    try {
      const response = await fetch(`/api/admin/offboard-campaigns/${selectedCampaign.id}/rollback-preview`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Rollback preview failed');
      setRollbackPreview(data.preview);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Rollback preview failed' });
    } finally {
      setIsWorking(false);
    }
  };

  const executeRollback = async () => {
    if (!selectedCampaign) return;
    if (!window.confirm('Execute rollback for all rollbackable campaign-caused changes?')) return;
    await runAction('Rollback', () =>
      fetchWithCsrf(`/api/admin/offboard-campaigns/${selectedCampaign.id}/rollback`, { method: 'POST' })
    );
    setRollbackPreview(null);
  };

  const exportUrl = (type: 'recipients' | 'logs') =>
    selectedCampaign ? `/api/admin/offboard-campaigns/${selectedCampaign.id}/export?type=${type}` : '#';

  return (
    <>
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CollapsibleTrigger className="w-full text-left">
          <CardHeader className="flex flex-row items-center justify-between gap-4 rounded-t-lg transition-colors hover:bg-muted/50">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldAlert className="h-5 w-5" />
                Offboard Campaigns
              </CardTitle>
              <CardDescription className="mt-1">
                Dry-run, wave-send, verify, enforce, audit, and roll back account offboarding.
              </CardDescription>
            </div>
            <ChevronDown className={`h-5 w-5 text-muted-foreground transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-6 border-t pt-5">
            {message && (
              <Alert variant={message.type === 'error' ? 'destructive' : 'default'} className={message.type === 'success' ? 'border-green-200 bg-green-50 text-green-900' : ''}>
                {message.type === 'error' ? <AlertTriangle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
                <AlertTitle>{message.type === 'error' ? 'Error' : 'Success'}</AlertTitle>
                <AlertDescription>{message.text}</AlertDescription>
              </Alert>
            )}

            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <TabsList>
                  <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
                  <TabsTrigger value="dry-run">New Dry Run</TabsTrigger>
                </TabsList>
                <Button variant="outline" size="sm" onClick={() => fetchCampaigns()} disabled={isLoading} className="gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </Button>
              </div>

              <TabsContent value="dry-run" className="space-y-5">
                <div className="grid gap-4 xl:grid-cols-[minmax(280px,360px)_1fr]">
                  <div className="space-y-4 rounded-lg border p-4">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-gray-900">Create Dry Run</h3>
                        <div className="flex flex-wrap gap-1.5">
                          <InfoTip label="Canary">
                            Wave 0 is a small first send used to validate recipients, email wording, links, and timing.
                          </InfoTip>
                          <InfoTip label="Waves">
                            Remaining recipients are grouped into batches. Each deadline begins only after that recipient&apos;s initial email succeeds.
                          </InfoTip>
                          <InfoTip label="Re-enrollment">
                            Campaign offboarding removes access but does not block a future request. Use the email block list to prevent re-enrollment.
                          </InfoTip>
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{targetUsernames.length} target account{targetUsernames.length === 1 ? '' : 's'} selected.</p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="offboard-name">Campaign name</Label>
                      <Input id="offboard-name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Spring cleanup" />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-2">
                        <Label htmlFor="offboard-wave-size">Wave size</Label>
                        <Input id="offboard-wave-size" type="number" min={1} value={form.waveSize} onChange={event => setForm({ ...form, waveSize: Number(event.target.value) })} />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="offboard-canary-size">Canary</Label>
                        <Input id="offboard-canary-size" type="number" min={0} value={form.canarySize} onChange={event => setForm({ ...form, canarySize: Number(event.target.value) })} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 rounded-md border bg-muted/30 p-3">
                      <Label htmlFor="offboard-pause-waves" className="text-sm">Pause after each wave</Label>
                      <Switch id="offboard-pause-waves" checked={form.pauseAfterEachWave} onCheckedChange={checked => setForm({ ...form, pauseAfterEachWave: checked })} />
                    </div>
                    <Button onClick={createDryRun} disabled={isWorking || targetUsernames.length === 0} className="w-full gap-2">
                      <Send className="h-4 w-4" />
                      Create Dry Run
                    </Button>
                  </div>

                  <div className="space-y-3 rounded-lg border p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-gray-900">Target Accounts</h3>
                        <p className="mt-1 text-xs text-muted-foreground">{selectableAccounts.length} Active Directory account{selectableAccounts.length === 1 ? '' : 's'} available.</p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="outline" size="sm" onClick={selectVisibleAccounts} disabled={visibleSelectableAccounts.length === 0}>Select Visible</Button>
                        <Button variant="ghost" size="sm" onClick={clearSelectedAccounts} disabled={targetUsernames.length === 0} className="gap-2">
                          <X className="h-4 w-4" />
                          Clear
                        </Button>
                      </div>
                    </div>

                    <div className="relative">
                      <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={accountSearch}
                        onChange={event => setAccountSearch(event.target.value)}
                        placeholder="Search username, name, or email"
                        className="pl-9"
                      />
                    </div>

                    <div className="max-h-[420px] overflow-auto rounded-lg border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-11">
                              <Checkbox
                                checked={allVisibleSelected}
                                onCheckedChange={checked => checked ? selectVisibleAccounts() : deselectVisibleAccounts()}
                                aria-label="Select visible accounts"
                              />
                            </TableHead>
                            <SortHead label="Account" sortKey="username" sort={targetSort} onSort={key => setTargetSort(nextSort(targetSort, key))} />
                            <SortHead label="Email" sortKey="email" sort={targetSort} onSort={key => setTargetSort(nextSort(targetSort, key))} />
                            <SortHead label="Last verified" sortKey="lastVerifiedAt" sort={targetSort} onSort={key => setTargetSort(nextSort(targetSort, key))} />
                            <SortHead label="Status" sortKey="accountEnabled" sort={targetSort} onSort={key => setTargetSort(nextSort(targetSort, key))} />
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {sortedTargetAccounts.map(account => {
                            const usernameKey = normalizeUsername(account.username);
                            const isSelected = selectedUsernames.has(usernameKey);
                            return (
                              <TableRow key={account.dn || account.username} className={isSelected ? 'bg-blue-50/70' : ''}>
                                <TableCell>
                                  <Checkbox
                                    checked={isSelected}
                                    disabled={!account.accountEnabled}
                                    onCheckedChange={checked => toggleAccountSelection(account.username, checked)}
                                    aria-label={`Select ${account.username}`}
                                  />
                                </TableCell>
                                <TableCell>
                                  <div className="font-mono text-sm font-medium">{account.username}</div>
                                  <div className="max-w-60 truncate text-xs text-muted-foreground">{account.displayName || '-'}</div>
                                </TableCell>
                                <TableCell className="max-w-[260px] truncate text-xs">{account.email || '-'}</TableCell>
                                <TableCell className="text-xs">
                                  <div>{formatLastVerified(account.lastVerifiedAt)}</div>
                                  <div className="text-muted-foreground">{verificationSourceLabel(account.lastVerifiedSource)}</div>
                                </TableCell>
                                <TableCell>
                                  {account.accountEnabled ? <Badge className="bg-green-100 text-green-800 hover:bg-green-100">enabled</Badge> : <Badge variant="secondary">disabled</Badge>}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                          {!accountsLoading && sortedTargetAccounts.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No accounts found.</TableCell>
                            </TableRow>
                          )}
                          {accountsLoading && (
                            <TableRow>
                              <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Loading accounts...</TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="offboard-included-users">Manual target usernames</Label>
                    <Textarea id="offboard-included-users" value={form.includedUsernames} onChange={event => setForm({ ...form, includedUsernames: event.target.value })} rows={6} placeholder="one username per line" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="offboard-excluded-users">Excluded usernames</Label>
                    <Textarea id="offboard-excluded-users" value={form.excludedUsernames} onChange={event => setForm({ ...form, excludedUsernames: event.target.value })} rows={6} placeholder="one username per line" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="offboard-excluded-emails">Excluded emails</Label>
                    <Textarea id="offboard-excluded-emails" value={form.excludedEmails} onChange={event => setForm({ ...form, excludedEmails: event.target.value })} rows={6} placeholder="one email per line" />
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="campaigns" className="space-y-5">
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <SortHead label="Campaign" sortKey="name" sort={campaignSort} onSort={key => setCampaignSort(nextSort(campaignSort, key))} />
                        <SortHead label="Status" sortKey="status" sort={campaignSort} onSort={key => setCampaignSort(nextSort(campaignSort, key))} />
                        <SortHead label="Created" sortKey="createdAt" sort={campaignSort} onSort={key => setCampaignSort(nextSort(campaignSort, key))} />
                        <SortHead label="Eligible" sortKey="eligibleRecipients" sort={campaignSort} onSort={key => setCampaignSort(nextSort(campaignSort, key))} />
                        <SortHead label="Sent" sortKey="sentCount" sort={campaignSort} onSort={key => setCampaignSort(nextSort(campaignSort, key))} />
                        <SortHead label="Verified" sortKey="verifiedCount" sort={campaignSort} onSort={key => setCampaignSort(nextSort(campaignSort, key))} />
                        <SortHead label="Enforced" sortKey="enforcedCount" sort={campaignSort} onSort={key => setCampaignSort(nextSort(campaignSort, key))} />
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sortedCampaigns.map(campaign => (
                        <TableRow key={campaign.id} className={campaign.id === selectedCampaign?.id ? 'bg-muted/40' : ''}>
                          <TableCell>
                            <button type="button" onClick={() => fetchCampaigns(campaign.id)} className="text-left">
                              <div className="font-medium text-foreground">{campaign.name}</div>
                              <div className="text-xs text-muted-foreground">by {campaign.createdBy}</div>
                            </button>
                          </TableCell>
                          <TableCell><StatusBadge status={campaign.status} /></TableCell>
                          <TableCell className="text-xs">{formatDate(campaign.createdAt)}</TableCell>
                          <TableCell>{campaign.eligibleRecipients}</TableCell>
                          <TableCell>{campaign.sentCount}</TableCell>
                          <TableCell>{campaign.verifiedCount}</TableCell>
                          <TableCell>{campaign.enforcedCount}</TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button size="sm" variant="outline" onClick={() => fetchCampaigns(campaign.id)}>Open</Button>
                              {campaign.status === 'dry_run' && (
                                <Button size="icon" variant="ghost" onClick={() => deleteDryRun(campaign)} disabled={isWorking} aria-label="Delete dry run">
                                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-destructive" />
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))}
                      {campaigns.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                            No offboard campaigns yet. Create a dry run to start.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>

                {selectedCampaign && (
                  <div className="space-y-4">
                    <div className="rounded-lg border p-4">
                      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="truncate text-lg font-semibold">{selectedCampaign.name}</h3>
                            <StatusBadge status={selectedCampaign.status} />
                            {selectedCampaign.sendingPaused && <Badge variant="outline">sending paused</Badge>}
                            {selectedCampaign.remindersPaused && <Badge variant="outline">reminders paused</Badge>}
                            {selectedCampaign.enforcementPaused && <Badge variant="outline">enforcement paused</Badge>}
                          </div>
                          <p className="mt-1 text-sm text-muted-foreground">
                            Wave {selectedCampaign.currentWave} - size {selectedCampaign.waveSize} - canary {selectedCampaign.canarySize} - pause gates {selectedCampaign.pauseAfterEachWave ? 'on' : 'off'}
                          </p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Enforced recipients are marked offboarded so they can submit a new request unless their email is on the block list.
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {selectedCampaign.status === 'dry_run' && (
                            <>
                              <Button size="sm" onClick={activateCampaign} disabled={isWorking} className="gap-2">
                                <Play className="h-4 w-4" />
                                Activate
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => deleteDryRun(selectedCampaign)} disabled={isWorking} className="gap-2">
                                <Trash2 className="h-4 w-4" />
                                Delete Dry Run
                              </Button>
                            </>
                          )}
                          {selectedCampaign.status === 'active' && (
                            <>
                              <div className="flex items-center gap-1">
                                <Button size="sm" onClick={openProcessAll} disabled={isWorking} className="gap-2">
                                  <ListChecks className="h-4 w-4" />
                                  Process All
                                </Button>
                                <InfoTip label="What runs">
                                  Preview pending initial emails, reminders currently due, and expired accounts ready for AD/VPN enforcement. Reminder dates are evaluated only when Process All or the external scheduler runs.
                                </InfoTip>
                              </div>
                              <Button size="sm" variant="outline" onClick={() => openExtension(null)} disabled={isWorking} className="gap-2">
                                <CalendarClock className="h-4 w-4" />
                                Extend Campaign
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => controlCampaign(selectedCampaign.sendingPaused ? 'resume_wave' : 'pause_sending')} disabled={isWorking} className="gap-2">
                                {selectedCampaign.sendingPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                                {selectedCampaign.sendingPaused ? 'Resume Wave' : 'Pause Sending'}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => controlCampaign(selectedCampaign.remindersPaused ? 'resume_reminders' : 'pause_reminders')} disabled={isWorking}>
                                {selectedCampaign.remindersPaused ? 'Resume Reminders' : 'Pause Reminders'}
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => controlCampaign(selectedCampaign.enforcementPaused ? 'resume_enforcement' : 'pause_enforcement')} disabled={isWorking}>
                                {selectedCampaign.enforcementPaused ? 'Resume Enforcement' : 'Pause Enforcement'}
                              </Button>
                              <Button size="sm" variant="destructive" onClick={() => controlCampaign('emergency_stop')} disabled={isWorking} className="gap-2">
                                <Ban className="h-4 w-4" />
                                Emergency Stop
                              </Button>
                              <Button size="sm" variant="outline" onClick={() => controlCampaign('cancel')} disabled={isWorking}>
                                Cancel
                              </Button>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                        {stats.map(([label, value]) => (
                          <div key={label} className="rounded-md border bg-muted/20 p-3">
                            <p className="text-xs text-muted-foreground">{label}</p>
                            <p className="mt-1 text-xl font-semibold">{value}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    <Tabs defaultValue="recipients">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <TabsList>
                          <TabsTrigger value="recipients">Recipients</TabsTrigger>
                          <TabsTrigger value="logs">Logs</TabsTrigger>
                          <TabsTrigger value="rollback">Rollback</TabsTrigger>
                        </TabsList>
                        <div className="flex flex-wrap gap-2">
                          {selectedCampaign.status === 'active' && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="gap-2"
                              disabled={selectedRecipientIds.size === 0}
                              onClick={() => openExtension(Array.from(selectedRecipientIds))}
                            >
                              <CalendarClock className="h-4 w-4" />
                              Extend Selected ({selectedRecipientIds.size})
                            </Button>
                          )}
                          <Button asChild variant="outline" size="sm" className="gap-2">
                            <a href={exportUrl('recipients')}>
                              <Download className="h-4 w-4" />
                              Recipients CSV
                            </a>
                          </Button>
                          <Button asChild variant="outline" size="sm" className="gap-2">
                            <a href={exportUrl('logs')}>
                              <Download className="h-4 w-4" />
                              Logs CSV
                            </a>
                          </Button>
                        </div>
                      </div>

                      <TabsContent value="recipients" className="rounded-lg border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-11">
                                <Checkbox
                                  checked={
                                    sortedRecipients.some(recipient => ['sent', 'enforced'].includes(recipient.status) && !recipient.verifiedAt) &&
                                    sortedRecipients
                                      .filter(recipient => ['sent', 'enforced'].includes(recipient.status) && !recipient.verifiedAt)
                                      .every(recipient => selectedRecipientIds.has(recipient.id))
                                  }
                                  onCheckedChange={checked => {
                                    const eligibleIds = sortedRecipients
                                      .filter(recipient => ['sent', 'enforced'].includes(recipient.status) && !recipient.verifiedAt)
                                      .map(recipient => recipient.id);
                                    setSelectedRecipientIds(previous => {
                                      const next = new Set(previous);
                                      eligibleIds.forEach(id => checked ? next.add(id) : next.delete(id));
                                      return next;
                                    });
                                  }}
                                  aria-label="Select all extendable recipients"
                                />
                              </TableHead>
                              <SortHead label="User" sortKey="adUsername" sort={recipientSort} onSort={key => setRecipientSort(nextSort(recipientSort, key))} />
                              <SortHead label="Email" sortKey="email" sort={recipientSort} onSort={key => setRecipientSort(nextSort(recipientSort, key))} />
                              <SortHead label="VPN" sortKey="linkedVpnUsername" sort={recipientSort} onSort={key => setRecipientSort(nextSort(recipientSort, key))} />
                              <SortHead label="Last verified" sortKey="lastVerifiedAt" sort={recipientSort} onSort={key => setRecipientSort(nextSort(recipientSort, key))} />
                              <SortHead label="Wave" sortKey="waveNumber" sort={recipientSort} onSort={key => setRecipientSort(nextSort(recipientSort, key))} />
                              <SortHead label="Status" sortKey="status" sort={recipientSort} onSort={key => setRecipientSort(nextSort(recipientSort, key))} />
                              <SortHead label="Deadline" sortKey="deadlineAt" sort={recipientSort} onSort={key => setRecipientSort(nextSort(recipientSort, key))} />
                              <SortHead label="Issue" sortKey="issue" sort={recipientSort} onSort={key => setRecipientSort(nextSort(recipientSort, key))} />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {sortedRecipients.map(recipient => (
                              <TableRow key={recipient.id}>
                                <TableCell>
                                  <Checkbox
                                    checked={selectedRecipientIds.has(recipient.id)}
                                    disabled={!['sent', 'enforced'].includes(recipient.status) || Boolean(recipient.verifiedAt)}
                                    onCheckedChange={checked => {
                                      setSelectedRecipientIds(previous => {
                                        const next = new Set(previous);
                                        if (checked) next.add(recipient.id);
                                        else next.delete(recipient.id);
                                        return next;
                                      });
                                    }}
                                    aria-label={`Select ${recipient.adUsername} for extension`}
                                  />
                                </TableCell>
                                <TableCell className="font-mono text-sm">{recipient.adUsername}</TableCell>
                                <TableCell className="text-xs">{recipient.email}</TableCell>
                                <TableCell className="font-mono text-xs">{recipient.linkedVpnUsername || '-'}</TableCell>
                                <TableCell className="text-xs">
                                  <div>{formatLastVerified(recipient.lastVerifiedAt)}</div>
                                  <div className="text-muted-foreground">{verificationSourceLabel(recipient.lastVerifiedSource)}</div>
                                </TableCell>
                                <TableCell>{recipient.waveNumber >= 0 ? recipient.waveNumber : '-'}</TableCell>
                                <TableCell><StatusBadge status={recipient.status} /></TableCell>
                                <TableCell className="text-xs">{formatDate(recipient.deadlineAt)}</TableCell>
                                <TableCell className="max-w-[320px] text-xs text-muted-foreground">
                                  <div className="truncate">
                                    {recipient.skipReason || recipient.lastError || recipient.projectedAction || '-'}
                                  </div>
                                  {recipient.latestExtension?.status === 'notification_failed' && (
                                    <Button
                                      size="sm"
                                      variant="link"
                                      className="mt-1 h-auto p-0 text-xs"
                                      disabled={isWorking}
                                      onClick={() => retryExtensionNotification(recipient.latestExtension!.id)}
                                    >
                                      Retry extension email
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            ))}
                            {selectedCampaign.recipients.length === 0 && (
                              <TableRow>
                                <TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No recipients in preview.</TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                      </TabsContent>

                      <TabsContent value="logs" className="rounded-lg border">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <SortHead label="Time" sortKey="createdAt" sort={logSort} onSort={key => { setLogSort(nextSort(logSort, key)); setLogPage(1); }} />
                              <SortHead label="Level" sortKey="level" sort={logSort} onSort={key => { setLogSort(nextSort(logSort, key)); setLogPage(1); }} />
                              <SortHead label="Event" sortKey="eventType" sort={logSort} onSort={key => { setLogSort(nextSort(logSort, key)); setLogPage(1); }} />
                              <SortHead label="Actor" sortKey="actor" sort={logSort} onSort={key => { setLogSort(nextSort(logSort, key)); setLogPage(1); }} />
                              <SortHead label="Message" sortKey="message" sort={logSort} onSort={key => { setLogSort(nextSort(logSort, key)); setLogPage(1); }} />
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {logs.map(log => (
                              <TableRow key={log.id}>
                                <TableCell className="text-xs">{formatDate(log.createdAt)}</TableCell>
                                <TableCell><StatusBadge status={log.level} /></TableCell>
                                <TableCell className="font-mono text-xs">{log.eventType}</TableCell>
                                <TableCell className="text-xs">{log.actor || '-'}</TableCell>
                                <TableCell className="max-w-[520px] whitespace-normal text-sm">{log.message}</TableCell>
                              </TableRow>
                            ))}
                            {logs.length === 0 && (
                              <TableRow>
                                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No logs yet.</TableCell>
                              </TableRow>
                            )}
                          </TableBody>
                        </Table>
                        <div className="flex flex-col gap-3 border-t bg-muted/10 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex items-center gap-2 text-sm text-muted-foreground">
                            <span>Rows</span>
                            <Select
                              value={String(logPageSize)}
                              onValueChange={value => {
                                setLogPageSize(Number(value));
                                setLogPage(1);
                              }}
                            >
                              <SelectTrigger className="h-8 w-20">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="10">10</SelectItem>
                                <SelectItem value="25">25</SelectItem>
                                <SelectItem value="50">50</SelectItem>
                                <SelectItem value="100">100</SelectItem>
                              </SelectContent>
                            </Select>
                            <span>
                              {logTotalCount === 0
                                ? '0 logs'
                                : `${(logPage - 1) * logPageSize + 1}-${Math.min(logPage * logPageSize, logTotalCount)} of ${logTotalCount}`}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={logPage <= 1}
                              onClick={() => setLogPage(page => Math.max(1, page - 1))}
                              className="gap-1"
                            >
                              <ChevronLeft className="h-4 w-4" />
                              Previous
                            </Button>
                            <span className="min-w-24 text-center text-sm text-muted-foreground">
                              Page {logPage} of {logTotalPages}
                            </span>
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={logPage >= logTotalPages}
                              onClick={() => setLogPage(page => Math.min(logTotalPages, page + 1))}
                              className="gap-1"
                            >
                              Next
                              <ChevronRight className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </TabsContent>

                      <TabsContent value="rollback" className="space-y-4 rounded-lg border p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Button variant="outline" size="sm" onClick={loadRollbackPreview} disabled={isWorking} className="gap-2">
                            <RotateCcw className="h-4 w-4" />
                            Preview Rollback
                          </Button>
                          <Button size="sm" onClick={executeRollback} disabled={isWorking || !rollbackPreview?.rollbackable} className="gap-2">
                            <RotateCcw className="h-4 w-4" />
                            Execute Rollback
                          </Button>
                          <Badge variant="outline">state: {selectedCampaign.rollbackState}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          Rollback re-enables only accounts changed by this campaign and restores the prior request status when it is still safe. Rows with conflicts are left untouched so an admin can recover them through Account Lifecycle or manual assignment.
                        </p>

                        {rollbackPreview ? (
                          <div className="space-y-3">
                            <div className="grid gap-3 sm:grid-cols-3">
                              <div className="rounded-md border bg-muted/20 p-3">
                                <p className="text-xs text-muted-foreground">Rollbackable</p>
                                <p className="text-xl font-semibold">{rollbackPreview.rollbackable}</p>
                              </div>
                              <div className="rounded-md border bg-muted/20 p-3">
                                <p className="text-xs text-muted-foreground">Conflicts</p>
                                <p className="text-xl font-semibold">{rollbackPreview.conflicts}</p>
                              </div>
                              <div className="rounded-md border bg-muted/20 p-3">
                                <p className="text-xs text-muted-foreground">Reviewed</p>
                                <p className="text-xl font-semibold">{rollbackPreview.total}</p>
                              </div>
                            </div>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <SortHead label="User" sortKey="adUsername" sort={rollbackSort} onSort={key => setRollbackSort(nextSort(rollbackSort, key))} />
                                  <SortHead label="Actions" sortKey="actions" sort={rollbackSort} onSort={key => setRollbackSort(nextSort(rollbackSort, key))} />
                                  <SortHead label="Conflicts" sortKey="conflicts" sort={rollbackSort} onSort={key => setRollbackSort(nextSort(rollbackSort, key))} />
                                  <SortHead label="Ready" sortKey="rollbackable" sort={rollbackSort} onSort={key => setRollbackSort(nextSort(rollbackSort, key))} />
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {sortedRollbackItems.slice(0, 50).map(item => (
                                  <TableRow key={item.recipientId}>
                                    <TableCell className="font-mono text-sm">{item.adUsername}</TableCell>
                                    <TableCell className="text-xs">{item.actions.join(', ') || '-'}</TableCell>
                                    <TableCell className="max-w-[420px] whitespace-normal text-xs text-muted-foreground">{item.conflicts.join('; ') || '-'}</TableCell>
                                    <TableCell>{item.rollbackable ? <Badge className="bg-green-100 text-green-800 hover:bg-green-100">yes</Badge> : <Badge variant="secondary">no</Badge>}</TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">Preview rollback before executing. Conflicts require manual review and are not changed.</p>
                        )}
                      </TabsContent>
                    </Tabs>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>

    <Dialog open={processAllOpen} onOpenChange={setProcessAllOpen}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Process All Due Campaign Work</DialogTitle>
          <DialogDescription>
            Review the live counts, choose the work categories to run, and explicitly override paused sections only for this operation.
          </DialogDescription>
        </DialogHeader>
        {processAllPreview && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              {([
                ['initialEmails', 'Initial Emails', Mail],
                ['reminders', 'Due Reminders', RefreshCw],
                ['enforcement', 'Expired Enforcement', ShieldAlert],
              ] as const).map(([key, label, Icon]) => {
                const section = processAllPreview.sections[key];
                const selected = processAllSelection[key];
                const overrideKey = key === 'initialEmails'
                  ? 'overrideSendingPause'
                  : key === 'reminders'
                    ? 'overrideRemindersPause'
                    : 'overrideEnforcementPause';
                return (
                  <div key={key} className={`rounded-xl border p-4 ${selected ? 'border-blue-300 bg-blue-50/50' : 'bg-muted/20'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-blue-700" />
                        <span className="text-sm font-semibold">{label}</span>
                      </div>
                      <Checkbox
                        checked={selected}
                        disabled={section.count === 0}
                        onCheckedChange={checked => setProcessAllSelection(previous => ({ ...previous, [key]: Boolean(checked) }))}
                        aria-label={`Process ${label}`}
                      />
                    </div>
                    <p className="mt-3 text-3xl font-semibold tracking-tight">{section.count}</p>
                    <p className="mt-2 text-xs leading-5 text-muted-foreground">{section.description}</p>
                    {key === 'reminders' && (
                      <>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Day 3: {processAllPreview.sections.reminders.day3} · Day 6: {processAllPreview.sections.reminders.day6} · Extended: {processAllPreview.sections.reminders.extension}
                        </p>
                        {processAllPreview.sections.reminders.suppressedExtension > 0 && (
                          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs leading-5 text-amber-900">
                            Suppressed unsafe extension reminders: {processAllPreview.sections.reminders.suppressedExtension}
                          </p>
                        )}
                      </>
                    )}
                    {key === 'enforcement' && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        AD disables: {processAllPreview.sections.enforcement.adDisables} · VPN revocations: {processAllPreview.sections.enforcement.vpnRevocations}
                      </p>
                    )}
                    {section.paused && (
                      <label className="mt-3 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                        Override pause once
                        <Switch
                          checked={Boolean(processAllSelection[overrideKey])}
                          onCheckedChange={checked => setProcessAllSelection(previous => ({ ...previous, [overrideKey]: checked }))}
                        />
                      </label>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="rounded-lg border bg-slate-950 p-4 text-slate-100">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Current recipient states</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {Object.entries(processAllPreview.statusCounts).map(([status, count]) => (
                  <span key={status} className="rounded-full border border-slate-700 px-2.5 py-1 text-xs">
                    {status.replaceAll('_', ' ')}: {count}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => setProcessAllOpen(false)}>Cancel</Button>
          <Button
            onClick={executeProcessAll}
            disabled={
              isWorking ||
              !processAllPreview?.runnable ||
              (!processAllSelection.initialEmails && !processAllSelection.reminders && !processAllSelection.enforcement)
            }
            className="gap-2"
          >
            <ListChecks className="h-4 w-4" />
            Run Selected Work
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={extensionOpen} onOpenChange={setExtensionOpen}>
      <DialogContent className="flex max-h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl xl:max-w-7xl">
        <DialogHeader className="shrink-0 border-b px-5 py-5 pr-12 sm:px-6">
          <DialogTitle>
            {extensionRecipientIds ? `Extend ${extensionRecipientIds.length} Selected Recipient${extensionRecipientIds.length === 1 ? '' : 's'}` : 'Extend Active Campaign'}
          </DialogTitle>
          <DialogDescription className="max-w-4xl leading-5">
            Verified and skipped recipients are never changed. Enforced recipients must pass AD, VPN, and request restoration checks before they can be reopened.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(18rem,21rem)_minmax(0,1fr)]">
            <div className="space-y-4 rounded-xl border bg-muted/10 p-4">
              <DateTimePicker
                label="New deadline"
                required
                value={extensionForm.newDeadline}
                minDate={new Date()}
                placeholder="Choose the new deadline"
                onChange={value => {
                  setExtensionPreview(null);
                  setExtensionForm(previous => ({ ...previous, newDeadline: value }));
                }}
              />
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>Custom reminders</Label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={extensionForm.reminderDates.length >= 5}
                    onClick={() => {
                      setExtensionPreview(null);
                      setExtensionForm(previous => ({ ...previous, reminderDates: [...previous.reminderDates, ''] }));
                    }}
                    className="h-8 gap-1"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add
                  </Button>
                </div>
                {extensionForm.reminderDates.length === 0 && (
                  <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">No extension reminders scheduled.</p>
                )}
                <p className="text-xs leading-5 text-muted-foreground">
                  Custom reminders must be at least {OFFBOARD_EXTENSION_REMINDER_MIN_LEAD_HOURS} hours after this extension is created and before the new deadline. They send only when Process All or the scheduler processes them.
                </p>
                {extensionForm.reminderDates.map((value, index) => (
                  <div key={index} className="flex min-w-0 items-start gap-2">
                    <DateTimePicker
                      value={value}
                      ariaLabel={`Reminder ${index + 1} date and time`}
                      minDate={minimumExtensionReminderDate}
                      maxDate={extensionForm.newDeadline ? new Date(extensionForm.newDeadline) : undefined}
                      placeholder={`Reminder ${index + 1}`}
                      className="min-w-0 flex-1"
                      onChange={nextValue => {
                        setExtensionPreview(null);
                        setExtensionForm(previous => ({
                          ...previous,
                          reminderDates: previous.reminderDates.map((item, itemIndex) => itemIndex === index ? nextValue : item),
                        }));
                      }}
                    />
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setExtensionPreview(null);
                        setExtensionForm(previous => ({
                          ...previous,
                          reminderDates: previous.reminderDates.filter((_, itemIndex) => itemIndex !== index),
                        }));
                      }}
                      aria-label={`Remove reminder ${index + 1}`}
                    >
                      <Minus className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <Label htmlFor="extension-note">Administrator note</Label>
                <Textarea
                  id="extension-note"
                  value={extensionForm.note}
                  onChange={event => {
                    setExtensionPreview(null);
                    setExtensionForm(previous => ({ ...previous, note: event.target.value }));
                  }}
                  rows={4}
                  placeholder="Optional context included in the extension email and audit history"
                />
              </div>
              <Button onClick={previewExtension} disabled={isWorking || !extensionForm.newDeadline} variant="outline" className="w-full gap-2">
                <Search className="h-4 w-4" />
                Preview Extension
              </Button>
            </div>

            <div className="min-w-0 space-y-4">
              {!extensionPreview ? (
                <div className="flex min-h-72 items-center justify-center rounded-xl border border-dashed bg-muted/10 p-8 text-center">
                  <div>
                    <CalendarClock className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="mt-3 text-sm font-medium">Choose a deadline and preview before applying changes.</p>
                    <p className="mt-1 text-xs text-muted-foreground">No account state changes occur during preview.</p>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {[
                      ['Eligible', extensionPreview.eligible],
                      ['Sent', extensionPreview.sent],
                      ['Reactivate', extensionPreview.enforced],
                      ['Excluded', extensionPreview.excluded],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-lg border bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className="mt-1 text-2xl font-semibold">{value}</p>
                      </div>
                    ))}
                  </div>
                  <div className="max-h-[min(48vh,32rem)] overflow-auto rounded-lg border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead>State</TableHead>
                          <TableHead>Result</TableHead>
                          <TableHead>Actions / conflicts</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {extensionPreview.items.map(item => (
                          <TableRow key={item.recipientId}>
                            <TableCell className="font-mono text-xs">{item.adUsername}</TableCell>
                            <TableCell><StatusBadge status={item.status} /></TableCell>
                            <TableCell>
                              {item.eligible
                                ? <Badge className="bg-green-100 text-green-800 hover:bg-green-100">ready</Badge>
                                : <Badge variant="secondary">{item.excludedReason?.replaceAll('_', ' ')}</Badge>}
                            </TableCell>
                            <TableCell className="max-w-[340px] whitespace-normal text-xs text-muted-foreground">
                              {item.conflicts.length > 0 ? item.conflicts.join('; ') : item.actions.join(', ')}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
        <DialogFooter className="shrink-0 border-t bg-background px-5 py-4 sm:px-6">
          <Button variant="outline" onClick={() => setExtensionOpen(false)}>Cancel</Button>
          <Button onClick={executeExtension} disabled={isWorking || !extensionPreview?.eligible} className="gap-2">
            <CalendarClock className="h-4 w-4" />
            Apply to {extensionPreview?.eligible || 0} Recipient{extensionPreview?.eligible === 1 ? '' : 's'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
