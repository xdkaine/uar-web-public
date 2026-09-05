'use client';

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import useSWR from 'swr';
import { fetchWithCsrf } from '@/lib/csrf';
import { fetchJson } from '@/lib/client-query';
import {
  getMinimumOffboardExtensionReminderDate,
  OFFBOARD_EXTENSION_REMINDER_MIN_LEAD_HOURS,
} from '@/lib/offboard-extension-schedule';
import DateTimePicker from '@/components/DateTimePicker';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { StatusBadge } from '@/components/ui/status-badge';
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
import { ActionImpactDialog } from '@/components/admin/ActionImpactDialog';
import { requestActionImpact } from '@/components/admin/actionImpactRequest';
import { useAdminNavigation } from '@/components/admin/AdminShell';
import { ClientLocalDate } from '@/components/admin/ClientLocalDate';
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
  workflowMode: 'verification' | 'direct';
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
  executionPaused: boolean;
  directOffboardReason: string | null;
  directOffboardReference: string | null;
  finalNoticeSentCount: number;
  finalNoticeFailureCount: number;
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
  finalNoticeStatus: string;
  finalNoticeSentAt: string | null;
  finalNoticeError: string | null;
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

interface OperationPreview {
  previewId: string;
  digest: string;
  expiresAt: string;
  kind: 'activation' | 'rollback';
  idempotencyKey: string;
  downloadUrl?: string;
  summary: { workflowMode?: 'verification' | 'direct'; total: number; executable: number; conflicts: number };
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
    executable?: boolean;
  }>;
}

interface ProcessAllPreview {
  campaignId: string;
  previewDigest: string;
  previewedAt: string;
  campaignStatus: string;
  workflowMode: 'verification' | 'direct';
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
    directOffboarding: {
      count: number;
      adDisables: number;
      vpnRevocations: number;
      sessionRevocations: number;
      finalNotices: number;
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

interface ExtensionReminder {
  id: string;
  value: string;
}

type SortDirection = 'asc' | 'desc';
type SortState<T extends string> = { key: T; direction: SortDirection };

interface OffboardCampaignsPanelProps {
  accounts?: SelectableCampaignAccount[];
  accountsLoading?: boolean;
  activeView?: 'campaigns' | 'dry-run';
  onViewChange?: (view: 'campaigns' | 'dry-run') => void;
}

const EMPTY_CAMPAIGN_ACCOUNTS: SelectableCampaignAccount[] = [];

type ActivationDraft = {
  preview: OperationPreview | null;
  dialogOpen: boolean;
  directAcknowledgement: string;
  directIrreversibleAcknowledgement: boolean;
};

const EMPTY_ACTIVATION_DRAFT: ActivationDraft = {
  preview: null,
  dialogOpen: false,
  directAcknowledgement: '',
  directIrreversibleAcknowledgement: false,
};

type ActivationDraftAction =
  | { type: 'open'; preview: OperationPreview }
  | { type: 'close' }
  | { type: 'setAcknowledgement'; value: string }
  | { type: 'setIrreversibleAcknowledgement'; value: boolean };

function activationDraftReducer(
  state: ActivationDraft,
  action: ActivationDraftAction,
): ActivationDraft {
  switch (action.type) {
    case 'open':
      return {
        preview: action.preview,
        dialogOpen: true,
        directAcknowledgement: '',
        directIrreversibleAcknowledgement: false,
      };
    case 'close':
      return EMPTY_ACTIVATION_DRAFT;
    case 'setAcknowledgement':
      return { ...state, directAcknowledgement: action.value };
    case 'setIrreversibleAcknowledgement':
      return { ...state, directIrreversibleAcknowledgement: action.value };
  }
}

type CampaignLoadState = {
  campaigns: CampaignSummary[];
  selectedCampaign: CampaignDetail | null;
  selectedCampaignId: string | null;
  isLoading: boolean;
};

const INITIAL_CAMPAIGN_LOAD_STATE: CampaignLoadState = {
  campaigns: [],
  selectedCampaign: null,
  selectedCampaignId: null,
  isLoading: false,
};

type CampaignLoadAction =
  | { type: 'loading'; value: boolean }
  | { type: 'loaded'; campaigns: CampaignSummary[]; selectedCampaign: CampaignDetail | null };

function campaignLoadReducer(state: CampaignLoadState, action: CampaignLoadAction): CampaignLoadState {
  if (action.type === 'loading') return { ...state, isLoading: action.value };
  return {
    campaigns: action.campaigns,
    selectedCampaign: action.selectedCampaign,
    selectedCampaignId: action.selectedCampaign?.id || action.campaigns[0]?.id || null,
    isLoading: false,
  };
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
        className="inline-flex h-7 items-center gap-1 rounded-full border bg-background px-2 text-xs font-medium text-muted-foreground transition-colors hover:border-blue-300 dark:hover:border-blue-700 hover:text-blue-700 dark:hover:text-blue-200 dark:text-blue-200 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
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

function OperationalStatusBadge({ status }: { status: string }) {
  if (['active', 'sent', 'verified', 'enforced', 'completed', 'rolled_back', 'info'].includes(status)) {
    return <StatusBadge tone="success">{status.replaceAll('_', ' ')}</StatusBadge>;
  }
  if (['skipped', 'enforcement_skipped', 'dry_run', 'warn'].includes(status)) {
    return <StatusBadge tone="warning">{status.replaceAll('_', ' ')}</StatusBadge>;
  }
  if (['cancelled', 'emergency_stopped', 'email_unknown', 'enforcement_failed', 'rollback_failed', 'error'].includes(status)) {
    return <StatusBadge tone={status === 'email_unknown' ? 'critical' : 'danger'}>{status.replaceAll('_', ' ')}</StatusBadge>;
  }
  return <StatusBadge tone="neutral" emphasis="outline">{status.replaceAll('_', ' ')}</StatusBadge>;
}

function CampaignDate({
  value,
  fallback = '-',
  format = 'date-time',
}: {
  value: string | null | undefined;
  fallback?: string;
  format?: 'date' | 'date-time';
}) {
  return value ? <ClientLocalDate value={value} format={format} /> : fallback;
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

function OffboardRecipientsTable({
  campaign, recipients, sort, selectedIds, allExtendableSelected, extendableIds,
  working, canExecuteDirect, onSort, onSelectionChange, onRetryExtension,
  onReconcileEnforcement, onReconcileFinalNotice,
}: {
  campaign: CampaignDetail;
  recipients: CampaignRecipient[];
  sort: SortState<'adUsername' | 'email' | 'linkedVpnUsername' | 'lastVerifiedAt' | 'waveNumber' | 'status' | 'deadlineAt' | 'issue'>;
  selectedIds: Set<string>;
  allExtendableSelected: boolean;
  extendableIds: string[];
  working: boolean;
  canExecuteDirect: boolean;
  onSort: (key: 'adUsername' | 'email' | 'linkedVpnUsername' | 'lastVerifiedAt' | 'waveNumber' | 'status' | 'deadlineAt' | 'issue') => void;
  onSelectionChange: React.Dispatch<React.SetStateAction<Set<string>>>;
  onRetryExtension: (extensionId: string) => Promise<void>;
  onReconcileEnforcement: (recipientId: string, outcome: 'not_applied' | 'verified_complete') => Promise<void>;
  onReconcileFinalNotice: (recipientId: string, outcome: 'not_delivered' | 'verified_delivered') => Promise<void>;
}) {
  const toggleAll = (checked: boolean) => onSelectionChange(previous => {
    const next = new Set(previous);
    extendableIds.forEach(id => checked ? next.add(id) : next.delete(id));
    return next;
  });
  const toggleRecipient = (id: string, checked: boolean) => onSelectionChange(previous => {
    const next = new Set(previous);
    if (checked) next.add(id); else next.delete(id);
    return next;
  });
  return <TabsContent value="recipients" className="rounded-lg border"><Table><TableHeader><TableRow><TableHead className="w-11"><Checkbox checked={allExtendableSelected} onCheckedChange={checked => toggleAll(Boolean(checked))} aria-label="Select all extendable recipients" /></TableHead>{([
    ['User', 'adUsername'], ['Email', 'email'], ['VPN', 'linkedVpnUsername'], ['Last verified', 'lastVerifiedAt'], ['Wave', 'waveNumber'], ['Status', 'status'], ['Deadline', 'deadlineAt'], ['Issue', 'issue'],
  ] as const).map(([label, key]) => <SortHead key={key} label={label} sortKey={key} sort={sort} onSort={onSort} />)}</TableRow></TableHeader><TableBody>{recipients.map(recipient => <OffboardRecipientRow key={recipient.id} recipient={recipient} workflowMode={campaign.workflowMode} selected={selectedIds.has(recipient.id)} working={working} canExecuteDirect={canExecuteDirect} onSelect={toggleRecipient} onRetryExtension={onRetryExtension} onReconcileEnforcement={onReconcileEnforcement} onReconcileFinalNotice={onReconcileFinalNotice} />)}{campaign.recipients.length === 0 && <TableRow><TableCell colSpan={9} className="py-8 text-center text-muted-foreground">No recipients in preview.</TableCell></TableRow>}</TableBody></Table></TabsContent>;
}

function OffboardRecipientRow({ recipient, workflowMode, selected, working, canExecuteDirect, onSelect, onRetryExtension, onReconcileEnforcement, onReconcileFinalNotice }: {
  recipient: CampaignRecipient; workflowMode: CampaignSummary['workflowMode']; selected: boolean; working: boolean; canExecuteDirect: boolean;
  onSelect: (id: string, checked: boolean) => void; onRetryExtension: (id: string) => Promise<void>;
  onReconcileEnforcement: (id: string, outcome: 'not_applied' | 'verified_complete') => Promise<void>;
  onReconcileFinalNotice: (id: string, outcome: 'not_delivered' | 'verified_delivered') => Promise<void>;
}) {
  const selectable = ['sent', 'enforced'].includes(recipient.status) && !recipient.verifiedAt;
  return <TableRow><TableCell><Checkbox checked={selected} disabled={!selectable} onCheckedChange={checked => onSelect(recipient.id, Boolean(checked))} aria-label={`Select ${recipient.adUsername} for extension`} /></TableCell><TableCell className="font-mono text-sm">{recipient.adUsername}</TableCell><TableCell className="text-xs">{recipient.email}</TableCell><TableCell className="font-mono text-xs">{recipient.linkedVpnUsername || '-'}</TableCell><TableCell className="text-xs"><div><CampaignDate value={recipient.lastVerifiedAt} fallback="N/A" format="date" /></div><div className="text-muted-foreground">{verificationSourceLabel(recipient.lastVerifiedSource)}</div></TableCell><TableCell>{recipient.waveNumber >= 0 ? recipient.waveNumber : '-'}</TableCell><TableCell><OperationalStatusBadge status={recipient.status} /></TableCell><TableCell className="text-xs"><CampaignDate value={recipient.deadlineAt} /></TableCell><OffboardRecipientActions recipient={recipient} workflowMode={workflowMode} working={working} canExecuteDirect={canExecuteDirect} onRetryExtension={onRetryExtension} onReconcileEnforcement={onReconcileEnforcement} onReconcileFinalNotice={onReconcileFinalNotice} /></TableRow>;
}

function OffboardRecipientActions({ recipient, workflowMode, working, canExecuteDirect, onRetryExtension, onReconcileEnforcement, onReconcileFinalNotice }: {
  recipient: CampaignRecipient; workflowMode: CampaignSummary['workflowMode']; working: boolean; canExecuteDirect: boolean;
  onRetryExtension: (id: string) => Promise<void>; onReconcileEnforcement: (id: string, outcome: 'not_applied' | 'verified_complete') => Promise<void>; onReconcileFinalNotice: (id: string, outcome: 'not_delivered' | 'verified_delivered') => Promise<void>;
}) {
  const controlsDisabled = working || (workflowMode === 'direct' && !canExecuteDirect);
  const retryExtension = recipient.latestExtension?.status === 'notification_failed';
  const reconcileEnforcement = recipient.status === 'enforcement_reconciliation_required';
  const directEnforced = workflowMode === 'direct' && recipient.status === 'enforced';
  return <TableCell className="max-w-[320px] text-xs text-muted-foreground"><div className="truncate">{recipient.skipReason || recipient.lastError || recipient.projectedAction || '-'}</div>{retryExtension && <Button size="sm" variant="link" className="mt-1 h-auto p-0 text-xs" disabled={working} onClick={() => void onRetryExtension(recipient.latestExtension!.id)}>Retry extension email</Button>}{reconcileEnforcement && <div className="mt-2 flex flex-wrap gap-1"><Button size="sm" variant="outline" disabled={controlsDisabled} onClick={() => void onReconcileEnforcement(recipient.id, 'not_applied')}>Re-arm with evidence</Button><Button size="sm" variant="outline" disabled={controlsDisabled} onClick={() => void onReconcileEnforcement(recipient.id, 'verified_complete')}>Certify complete</Button></div>}{directEnforced && <OffboardFinalNoticeControls recipient={recipient} working={working} canExecuteDirect={canExecuteDirect} onReconcile={onReconcileFinalNotice} />}</TableCell>;
}

function OffboardFinalNoticeControls({ recipient, working, canExecuteDirect, onReconcile }: { recipient: CampaignRecipient; working: boolean; canExecuteDirect: boolean; onReconcile: (id: string, outcome: 'not_delivered' | 'verified_delivered') => Promise<void> }) {
  return <div className="mt-2 space-y-2"><div className="flex items-center gap-2"><span>Final notice</span><OperationalStatusBadge status={recipient.finalNoticeStatus} /></div>{recipient.finalNoticeStatus === 'reconciliation_required' && <div className="flex flex-wrap gap-1"><Button size="sm" variant="outline" disabled={working || !canExecuteDirect} onClick={() => void onReconcile(recipient.id, 'not_delivered')}>Verify not delivered and retry</Button><Button size="sm" variant="outline" disabled={working || !canExecuteDirect} onClick={() => void onReconcile(recipient.id, 'verified_delivered')}>Certify delivered</Button></div>}<Button asChild size="sm" variant="link" className="h-auto p-0 text-xs"><a href={`/admin/lifecycle?search=${encodeURIComponent(recipient.adUsername)}`}>Review manual deletion eligibility in Account Lifecycle</a></Button></div>;
}

function OffboardTargetAccountsTable({ accounts, accountsLoading, selectedUsernames, workflowMode, sort, allVisibleSelected, onSort, onToggleAccount, onSelectVisible, onDeselectVisible }: {
  accounts: SelectableCampaignAccount[]; accountsLoading: boolean; selectedUsernames: Set<string>; workflowMode: 'verification' | 'direct';
  sort: SortState<'username' | 'email' | 'lastVerifiedAt' | 'accountEnabled'>; allVisibleSelected: boolean;
  onSort: (key: 'username' | 'email' | 'lastVerifiedAt' | 'accountEnabled') => void; onToggleAccount: (username: string, checked: boolean | 'indeterminate') => void;
  onSelectVisible: () => void; onDeselectVisible: () => void;
}) {
  return <div className="max-h-[420px] overflow-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead className="w-11"><Checkbox checked={allVisibleSelected} onCheckedChange={checked => checked ? onSelectVisible() : onDeselectVisible()} aria-label="Select visible accounts" /></TableHead>{([['Account', 'username'], ['Email', 'email'], ['Last verified', 'lastVerifiedAt'], ['Status', 'accountEnabled']] as const).map(([label, key]) => <SortHead key={key} label={label} sortKey={key} sort={sort} onSort={onSort} />)}</TableRow></TableHeader><TableBody>{accounts.map(account => <OffboardTargetAccountRow key={account.dn || account.username} account={account} selected={selectedUsernames.has(normalizeUsername(account.username))} direct={workflowMode === 'direct'} onToggle={onToggleAccount} />)}{!accountsLoading && accounts.length === 0 && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">No accounts found.</TableCell></TableRow>}{accountsLoading && <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">Loading accounts...</TableCell></TableRow>}</TableBody></Table></div>;
}

function OffboardTargetAccountRow({ account, selected, direct, onToggle }: { account: SelectableCampaignAccount; selected: boolean; direct: boolean; onToggle: (username: string, checked: boolean | 'indeterminate') => void }) {
  return <TableRow className={selected ? 'bg-blue-50/70 dark:bg-blue-950/40' : ''}><TableCell><Checkbox checked={selected} disabled={!account.accountEnabled && !direct} onCheckedChange={checked => onToggle(account.username, checked)} aria-label={`Select ${account.username}`} /></TableCell><TableCell><div className="font-mono text-sm font-medium">{account.username}</div><div className="max-w-60 truncate text-xs text-muted-foreground">{account.displayName || '-'}</div></TableCell><TableCell className="max-w-[260px] truncate text-xs">{account.email || '-'}</TableCell><TableCell className="text-xs"><div><CampaignDate value={account.lastVerifiedAt} fallback="N/A" format="date" /></div><div className="text-muted-foreground">{verificationSourceLabel(account.lastVerifiedSource)}</div></TableCell><TableCell>{account.accountEnabled ? <Badge className="bg-green-100 dark:bg-green-950/60 text-green-800 dark:text-green-200 hover:bg-green-100 dark:bg-green-950/60">enabled</Badge> : <Badge variant="secondary">disabled</Badge>}</TableCell></TableRow>;
}

function OffboardRollbackPreviewTable({ items, sort, onSort }: { items: OperationPreview['items']; sort: SortState<'adUsername' | 'actions' | 'conflicts' | 'rollbackable'>; onSort: (key: 'adUsername' | 'actions' | 'conflicts' | 'rollbackable') => void }) {
  return <Table><TableHeader><TableRow>{([['User', 'adUsername'], ['Actions', 'actions'], ['Conflicts', 'conflicts'], ['Ready', 'rollbackable']] as const).map(([label, key]) => <SortHead key={key} label={label} sortKey={key} sort={sort} onSort={onSort} />)}</TableRow></TableHeader><TableBody>{items.slice(0, 50).map(item => <TableRow key={item.recipientId}><TableCell className="font-mono text-sm">{item.adUsername}</TableCell><TableCell className="text-xs">{item.actions.join(', ') || '-'}</TableCell><TableCell className="max-w-[420px] whitespace-normal text-xs text-muted-foreground">{item.conflicts.join('; ') || '-'}</TableCell><TableCell>{item.rollbackable ? <Badge className="bg-green-100 dark:bg-green-950/60 text-green-800 dark:text-green-200 hover:bg-green-100 dark:bg-green-950/60">yes</Badge> : <Badge variant="secondary">no</Badge>}</TableCell></TableRow>)}</TableBody></Table>;
}

function useOffboardCampaignController({
  accounts = EMPTY_CAMPAIGN_ACCOUNTS,
  accountsLoading = false,
  activeView,
  onViewChange,
}: OffboardCampaignsPanelProps) {
  const navigation = useAdminNavigation();
  const canExecuteDirect = navigation?.permissions.has('offboard.execute_direct') ?? false;
  const [isOpen, setIsOpen] = useState(true);
  const [internalActiveTab, setInternalActiveTab] = useState<'campaigns' | 'dry-run'>('campaigns');
  const activeTab = activeView ?? internalActiveTab;
  const setActiveTab = (view: string) => {
    if (view !== 'campaigns' && view !== 'dry-run') return;
    setInternalActiveTab(view);
    onViewChange?.(view);
  };
  const [campaignLoad, dispatchCampaignLoad] = useReducer(
    campaignLoadReducer,
    INITIAL_CAMPAIGN_LOAD_STATE,
  );
  const { campaigns, selectedCampaign, selectedCampaignId, isLoading } = campaignLoad;
  const [isWorking, setIsWorking] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'warning' | 'error'; text: string } | null>(null);
  const [rollbackPreview, setRollbackPreview] = useState<OperationPreview | null>(null);
  const [activationDraft, dispatchActivationDraft] = useReducer(
    activationDraftReducer,
    EMPTY_ACTIVATION_DRAFT,
  );
  const {
    preview: activationPreview,
    dialogOpen: activationDialogOpen,
    directAcknowledgement,
    directIrreversibleAcknowledgement,
  } = activationDraft;
  const [rollbackDialogOpen, setRollbackDialogOpen] = useState(false);
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
    directOffboarding: false,
    overrideSendingPause: false,
    overrideRemindersPause: false,
    overrideEnforcementPause: false,
    overrideExecutionPause: false,
  });
  const [extensionOpen, setExtensionOpen] = useState(false);
  const [extensionMinimumDate, setExtensionMinimumDate] = useState<Date | null>(null);
  const [extensionPreview, setExtensionPreview] = useState<ExtensionPreview | null>(null);
  const [extensionRecipientIds, setExtensionRecipientIds] = useState<string[] | null>(null);
  const reminderSequence = useRef(0);
  const [extensionForm, setExtensionForm] = useState({
    newDeadline: '',
    reminderDates: [] as ExtensionReminder[],
    note: '',
  });

  const minimumExtensionReminderDate = getMinimumOffboardExtensionReminderDate();
  const [logs, setLogs] = useState<CampaignLog[]>([]);
  const [logPage, setLogPage] = useState(1);
  const [logPageSize, setLogPageSize] = useState(25);
  const [logTotalCount, setLogTotalCount] = useState(0);
  const [logTotalPages, setLogTotalPages] = useState(1);
  const [form, setForm] = useState({
    workflowMode: 'verification' as 'verification' | 'direct',
    name: '',
    waveSize: 25,
    canarySize: 0,
    pauseAfterEachWave: true,
    includedUsernames: '',
    excludedUsernames: '',
    excludedEmails: '',
    directOffboardReason: '',
    directOffboardReference: '',
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
    sortedTargetAccounts.filter(account => account.accountEnabled || form.workflowMode === 'direct')
  ), [form.workflowMode, sortedTargetAccounts]);

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

  const extendableRecipientIds = useMemo(() => {
    const ids: string[] = [];
    for (const recipient of sortedRecipients) {
      if ((recipient.status === 'sent' || recipient.status === 'enforced') && !recipient.verifiedAt) {
        ids.push(recipient.id);
      }
    }
    return ids;
  }, [sortedRecipients]);

  const allExtendableRecipientsSelected = extendableRecipientIds.length > 0
    && extendableRecipientIds.every(id => selectedRecipientIds.has(id));

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
    if (selectedCampaign.workflowMode === 'direct') {
      return [
        ['Eligible', selectedCampaign.eligibleRecipients],
        ['Skipped', selectedCampaign.skippedRecipients],
        ['Enforced', selectedCampaign.enforcedCount],
        ['Notices sent', selectedCampaign.finalNoticeSentCount],
        ['Notice review', selectedCampaign.finalNoticeFailureCount],
        ['Failures', selectedCampaign.failedCount],
      ];
    }
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
    dispatchCampaignLoad({ type: 'loading', value: true });
    try {
      const url = campaignId
        ? `/api/admin/offboard-campaigns?id=${encodeURIComponent(campaignId)}`
        : '/api/admin/offboard-campaigns';
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to load offboard campaigns');
      const data = await response.json();
      dispatchCampaignLoad({ type: 'loaded', campaigns: data.campaigns || [], selectedCampaign: data.selectedCampaign || null });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to load campaigns' });
    } finally {
      dispatchCampaignLoad({ type: 'loading', value: false });
    }
  };

  useSWR<{ campaigns?: CampaignSummary[]; selectedCampaign?: CampaignDetail | null }>(
    '/api/admin/offboard-campaigns',
    fetchJson,
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      onSuccess: (data) => {
        dispatchCampaignLoad({ type: 'loaded', campaigns: data.campaigns || [], selectedCampaign: data.selectedCampaign || null });
      },
      onError: (error) => {
        setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to load campaigns' });
        dispatchCampaignLoad({ type: 'loading', value: false });
      },
    }
  );

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

  const logParams = new URLSearchParams({
    page: String(logPage),
    pageSize: String(logPageSize),
    sortKey: logSort.key,
    sortDirection: logSort.direction,
  });
  useSWR<{ logs?: CampaignLog[]; pagination?: { page?: number; totalCount?: number; totalPages?: number } }>(
    selectedCampaignId
      ? `/api/admin/offboard-campaigns/${selectedCampaignId}/logs?${logParams}`
      : null,
    fetchJson,
    {
      keepPreviousData: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      onSuccess: (data) => {
        setLogs(data.logs || []);
        setLogPage(data.pagination?.page || 1);
        setLogTotalCount(data.pagination?.totalCount || 0);
        setLogTotalPages(data.pagination?.totalPages || 1);
      },
      onError: (error) => setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to load campaign logs',
      }),
    }
  );

  useEffect(() => {
    setLogs([]);
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
      setMessage({ type: data.partial ? 'warning' : 'success', text: data.message || `${label} completed` });
      await fetchCampaigns(nextCampaignId === undefined ? data.campaign?.id || selectedCampaignId : nextCampaignId);
      return !data.partial;
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
    if (form.workflowMode === 'direct') {
      if (!canExecuteDirect) {
        setMessage({ type: 'error', text: 'You need the Direct Offboarding privilege to create this reviewed route.' });
        return;
      }
      if (form.directOffboardReason.trim().length < 10 || form.directOffboardReference.trim().length < 3) {
        setMessage({ type: 'error', text: 'Direct offboarding requires a substantive reason and a ticket or change reference.' });
        return;
      }
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
    setIsWorking(true);
    setMessage(null);
    try {
      const response = await fetchWithCsrf(`/api/admin/offboard-campaigns/${selectedCampaign.id}/activate-preview`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Activation preview failed');
      dispatchActivationDraft({
        type: 'open',
        preview: { ...data.preview, idempotencyKey: crypto.randomUUID() },
      });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Activation preview failed' });
    } finally {
      setIsWorking(false);
    }
  };

  const executeActivation = async () => {
    if (!selectedCampaign || !activationPreview) return;
    const succeeded = await runAction('Activate campaign', () =>
      fetchWithCsrf(`/api/admin/offboard-campaigns/${selectedCampaign.id}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': activationPreview.idempotencyKey },
        body: JSON.stringify({
          previewId: activationPreview.previewId,
          digest: activationPreview.digest,
          ...(selectedCampaign.workflowMode === 'direct' ? {
            directAcknowledgement,
            irreversibleAcknowledgement: directIrreversibleAcknowledgement,
          } : {}),
        }),
      })
    );
    if (succeeded) {
      dispatchActivationDraft({ type: 'close' });
    }
  };

  const deleteDryRun = async (campaign: CampaignSummary) => {
    const decision = await requestActionImpact({ title: 'Delete offboarding dry run', description: `Delete "${campaign.name}". This removes only the dry-run snapshot and cannot be undone.`, items: [{ label: 'Campaign', value: campaign.name }, { label: 'External effects', value: 'None; this is a dry-run snapshot' }], confirmLabel: 'Delete dry run', destructive: true, evidence: 'The deletion is audited; no directory, VPN, or email action is performed.' });
    if (!decision.confirmed) return;
    await runAction('Delete dry run', () =>
      fetchWithCsrf(`/api/admin/offboard-campaigns/${campaign.id}`, { method: 'DELETE' }),
      selectedCampaignId === campaign.id ? null : selectedCampaignId
    );
  };

  const controlCampaign = async (action: string) => {
    if (!selectedCampaign) return;
    const destructive = action === 'cancel' || action === 'emergency_stop';
    if (destructive) {
      const decision = await requestActionImpact({ title: `${action.replaceAll('_', ' ')} campaign`, description: `Apply ${action.replaceAll('_', ' ')} to ${selectedCampaign.name}.`, items: [{ label: 'Campaign', value: selectedCampaign.name }, { label: 'Queued effects', value: 'No uncertain external action is replayed automatically', tone: 'warning' }], confirmLabel: action === 'cancel' ? 'Cancel campaign' : 'Emergency stop', destructive: true, evidence: 'The control change and subsequent reconciliation state are audited.' });
      if (!decision.confirmed) return;
    }
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
        initialEmails: preview.workflowMode === 'verification' && preview.sections.initialEmails.count > 0,
        reminders: preview.workflowMode === 'verification' && preview.sections.reminders.count > 0,
        enforcement: preview.workflowMode === 'verification' && preview.sections.enforcement.count > 0,
        directOffboarding: preview.workflowMode === 'direct' && preview.sections.directOffboarding.count > 0,
        overrideSendingPause: false,
        overrideRemindersPause: false,
        overrideEnforcementPause: false,
        overrideExecutionPause: false,
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
        body: JSON.stringify({
          ...processAllSelection,
          previewDigest: processAllPreview?.previewDigest,
          previewedAt: processAllPreview?.previewedAt,
        }),
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
    const reminderDates: string[] = [];
    for (const reminder of extensionForm.reminderDates) {
      if (reminder.value) reminderDates.push(new Date(reminder.value).toISOString());
    }
    return {
      ...(extensionRecipientIds ? { recipientIds: extensionRecipientIds } : {}),
      newDeadline: new Date(extensionForm.newDeadline).toISOString(),
      reminderDates,
      note: extensionForm.note,
    };
  };

  const openExtension = (recipientIds: string[] | null) => {
    setExtensionMinimumDate(new Date());
    setExtensionRecipientIds(recipientIds);
    setExtensionPreview(null);
    setExtensionForm({ newDeadline: '', reminderDates: [], note: '' });
    setExtensionOpen(true);
  };

  const addExtensionReminder = () => {
    reminderSequence.current += 1;
    setExtensionPreview(null);
    setExtensionForm(previous => ({
      ...previous,
      reminderDates: [...previous.reminderDates, { id: `reminder-${reminderSequence.current}`, value: '' }],
    }));
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

  const reconcileEnforcement = async (
    recipientId: string,
    resolution: 'not_applied' | 'verified_complete'
  ) => {
    if (!selectedCampaign) return;
    const evidence = window.prompt(
      resolution === 'not_applied'
        ? 'Enter evidence that no directory, VPN, or session effect occurred. This will re-arm enforcement.'
        : 'Enter evidence that directory, VPN, and session revocation are all complete.'
    )?.trim();
    if (!evidence) return;
    const succeeded = await runAction('Reconcile enforcement', () =>
      fetchWithCsrf(
        `/api/admin/offboard-campaigns/${selectedCampaign.id}/recipients/${recipientId}/reconcile-enforcement`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resolution, evidence }),
        }
      )
    );
    if (succeeded) await fetchLogs();
  };

  const reconcileFinalNotice = async (
    recipientId: string,
    resolution: 'not_delivered' | 'verified_delivered',
  ) => {
    if (!selectedCampaign) return;
    const evidence = window.prompt(
      resolution === 'not_delivered'
        ? 'Enter evidence that SMTP did not deliver the notice. The notice will be retried once.'
        : 'Enter provider evidence that the completed-offboarding notice was delivered.',
    )?.trim();
    if (!evidence) return;
    const succeeded = await runAction('Reconcile final notice', () =>
      fetchWithCsrf(
        `/api/admin/offboard-campaigns/${selectedCampaign.id}/recipients/${recipientId}/reconcile-notice`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ resolution, evidence }),
        },
      ),
    );
    if (succeeded) await fetchLogs();
  };

  const loadRollbackPreview = async () => {
    if (!selectedCampaign) return;
    setIsWorking(true);
    try {
      const response = await fetchWithCsrf(`/api/admin/offboard-campaigns/${selectedCampaign.id}/rollback-preview`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Rollback preview failed');
      const preview = data.preview as OperationPreview;
      setRollbackPreview({
        ...preview,
        idempotencyKey: crypto.randomUUID(),
        total: preview.summary.total,
        rollbackable: preview.summary.executable,
        conflicts: preview.summary.conflicts,
        items: preview.items.map(item => ({ ...item, rollbackable: item.executable === true })),
      });
      setRollbackDialogOpen(true);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Rollback preview failed' });
    } finally {
      setIsWorking(false);
    }
  };

  const executeRollback = async () => {
    if (!selectedCampaign || !rollbackPreview) return;
    const succeeded = await runAction('Rollback', () =>
      fetchWithCsrf(`/api/admin/offboard-campaigns/${selectedCampaign.id}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': rollbackPreview.idempotencyKey },
        body: JSON.stringify({ previewId: rollbackPreview.previewId, digest: rollbackPreview.digest }),
      })
    );
    if (succeeded) {
      setRollbackDialogOpen(false);
      setRollbackPreview(null);
    }
  };

  const exportUrl = (type: 'recipients' | 'logs') =>
    selectedCampaign ? `/api/admin/offboard-campaigns/${selectedCampaign.id}/export?type=${type}` : '#';

  return {
    accounts,
    accountsLoading,
    activeTab,
    setActiveTab,
    canExecuteDirect,
    isOpen,
    setIsOpen,
    isLoading,
    isWorking,
    message,
    fetchCampaigns,
    targetUsernames,
    form,
    setForm,
    createDryRun,
    selectableAccounts,
    visibleSelectableAccounts,
    clearSelectedAccounts,
    selectVisibleAccounts,
    deselectVisibleAccounts,
    accountSearch,
    setAccountSearch,
    sortedTargetAccounts,
    selectedUsernames,
    targetSort,
    setTargetSort,
    allVisibleSelected,
    toggleAccountSelection,
    campaigns,
    sortedCampaigns,
    selectedCampaign,
    campaignSort,
    setCampaignSort,
    deleteDryRun,
    stats,
    activateCampaign,
    openProcessAll,
    controlCampaign,
    openExtension,
    selectedRecipientIds,
    sortedRecipients,
    recipientSort,
    setRecipientSort,
    allExtendableRecipientsSelected,
    extendableRecipientIds,
    setSelectedRecipientIds,
    retryExtensionNotification,
    reconcileEnforcement,
    reconcileFinalNotice,
    exportUrl,
    logs,
    logPage,
    setLogPage,
    logPageSize,
    setLogPageSize,
    logTotalCount,
    logTotalPages,
    logSort,
    setLogSort,
    fetchLogs,
    loadRollbackPreview,
    rollbackPreview,
    sortedRollbackItems,
    rollbackSort,
    setRollbackSort,
    activationDialogOpen,
    dispatchActivationDraft,
    activationPreview,
    directIrreversibleAcknowledgement,
    directAcknowledgement,
    executeActivation,
    rollbackDialogOpen,
    setRollbackDialogOpen,
    executeRollback,
    processAllOpen,
    setProcessAllOpen,
    processAllPreview,
    processAllSelection,
    setProcessAllSelection,
    executeProcessAll,
    extensionOpen,
    setExtensionOpen,
    extensionRecipientIds,
    extensionForm,
    setExtensionForm,
    extensionMinimumDate,
    minimumExtensionReminderDate,
    addExtensionReminder,
    extensionPreview,
    setExtensionPreview,
    previewExtension,
    executeExtension,
  };
}

type OffboardCampaignController = ReturnType<typeof useOffboardCampaignController>;

function OffboardCampaignsWorkspace({ controller }: { controller: OffboardCampaignController }) {
  return (
    <>
      <OffboardCampaignsCard controller={controller} />
      <OffboardConfirmationDialogs controller={controller} />
      <OffboardProcessAllDialog controller={controller} />
      <OffboardExtensionDialog controller={controller} />
    </>
  );
}

function OffboardCampaignsCard({ controller }: { controller: OffboardCampaignController }) {
  const { activeTab, setActiveTab, fetchCampaigns, isLoading, isOpen, setIsOpen, message } = controller;
  return (
    <>
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card id="offboard-campaigns" className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
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
              <Alert
                variant={message.type === 'error' ? 'destructive' : 'default'}
                className={message.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950/40 dark:text-green-200'
                  : message.type === 'warning'
                    ? 'border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200'
                    : ''}
              >
                {message.type === 'success' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                <AlertTitle>{message.type === 'error' ? 'Error' : message.type === 'warning' ? 'Needs review' : 'Success'}</AlertTitle>
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

              <OffboardDryRunWorkspace controller={controller} />
              <OffboardCampaignWorkspace controller={controller} />
            </Tabs>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>

    </>
  );
}

function OffboardDryRunWorkspace({ controller }: { controller: OffboardCampaignController }) {
  const { accountsLoading, accountSearch, allVisibleSelected, canExecuteDirect, clearSelectedAccounts, createDryRun, deselectVisibleAccounts, form, isWorking, selectableAccounts, selectVisibleAccounts, selectedUsernames, setAccountSearch, setForm, setTargetSort, sortedTargetAccounts, targetSort, targetUsernames, toggleAccountSelection, visibleSelectableAccounts } = controller;
  return (
              <TabsContent value="dry-run" className="space-y-5">
                <div className="grid gap-4 xl:grid-cols-[minmax(280px,360px)_1fr]">
                  <div className="space-y-4 rounded-lg border p-4">
                    <div className="space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-foreground">Create Dry Run</h3>
                        <div className="flex flex-wrap gap-1.5">
                          <InfoTip label="Canary">
                            Wave 0 limits the first release. Verification sends email; direct mode performs the reviewed access changes.
                          </InfoTip>
                          <InfoTip label="Waves">
                            Remaining recipients are grouped into batches with an optional operator pause between each wave.
                          </InfoTip>
                          <InfoTip label="Re-enrollment">
                            Campaign offboarding removes access but does not block a future request. Use the email block list to prevent re-enrollment.
                          </InfoTip>
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{targetUsernames.length} target account{targetUsernames.length === 1 ? '' : 's'} selected.</p>
                    </div>
                    <fieldset className="space-y-2">
                      <legend className="text-sm font-medium">Offboarding route</legend>
                      <div className="grid gap-2">
                        <button
                          type="button"
                          onClick={() => setForm(previous => ({ ...previous, workflowMode: 'verification' }))}
                          className={`rounded-lg border p-3 text-left transition-colors ${form.workflowMode === 'verification' ? 'border-blue-400 bg-blue-50/70 dark:border-blue-800 dark:bg-blue-950/40' : 'hover:bg-muted/40'}`}
                        >
                          <span className="flex items-center gap-2 text-sm font-semibold"><Mail className="h-4 w-4" /> Verification campaign</span>
                          <span className="mt-1 block text-xs leading-5 text-muted-foreground">Email each account holder, wait seven days, then enforce only when they do not verify.</span>
                        </button>
                        <button
                          type="button"
                          disabled={!canExecuteDirect}
                          onClick={() => setForm(previous => ({ ...previous, workflowMode: 'direct' }))}
                          className={`rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${form.workflowMode === 'direct' ? 'border-amber-400 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/40' : 'hover:bg-muted/40'}`}
                        >
                          <span className="flex items-center gap-2 text-sm font-semibold"><ShieldAlert className="h-4 w-4" /> Direct offboarding</span>
                          <span className="mt-1 block text-xs leading-5 text-muted-foreground">Skip verification. Disable AD, revoke linked VPN and sessions, mark the request offboarded, then send a completion notice.</span>
                          {!canExecuteDirect && <span className="mt-1 block text-xs text-amber-700 dark:text-amber-300">Requires Direct Offboarding privilege.</span>}
                        </button>
                      </div>
                    </fieldset>
                    <div className="space-y-2">
                      <Label htmlFor="offboard-name">Campaign name</Label>
                      <Input id="offboard-name" value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="Spring cleanup" />
                    </div>
                    {form.workflowMode === 'direct' && (
                      <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
                        <div className="space-y-2">
                          <Label htmlFor="offboard-direct-reference">Ticket or change reference</Label>
                          <Input id="offboard-direct-reference" value={form.directOffboardReference} onChange={event => setForm({ ...form, directOffboardReference: event.target.value })} placeholder="INC-1234 or CHG-1234" />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="offboard-direct-reason">Approved offboarding reason</Label>
                          <Textarea id="offboard-direct-reason" value={form.directOffboardReason} onChange={event => setForm({ ...form, directOffboardReason: event.target.value })} rows={4} placeholder="Why these accounts are known to require immediate offboarding" />
                        </div>
                        <p className="text-xs leading-5 text-amber-900 dark:text-amber-200">This route does not delete AD objects or VPN records. Permanent deletion remains a separately reviewed manual action in Account Lifecycle.</p>
                      </div>
                    )}
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
                    <Button
                      onClick={createDryRun}
                      disabled={isWorking || targetUsernames.length === 0 || (form.workflowMode === 'direct' && (!canExecuteDirect || form.directOffboardReason.trim().length < 10 || form.directOffboardReference.trim().length < 3))}
                      className="w-full gap-2"
                    >
                      <Send className="h-4 w-4" />
                      Create Dry Run
                    </Button>
                  </div>

                  <div className="space-y-3 rounded-lg border p-4">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                      <div>
                        <h3 className="text-sm font-semibold text-foreground">Target Accounts</h3>
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

                    <OffboardTargetAccountsTable
                      accounts={sortedTargetAccounts}
                      accountsLoading={accountsLoading}
                      selectedUsernames={selectedUsernames}
                      workflowMode={form.workflowMode}
                      sort={targetSort}
                      allVisibleSelected={allVisibleSelected}
                      onSort={key => setTargetSort(nextSort(targetSort, key))}
                      onToggleAccount={toggleAccountSelection}
                      onSelectVisible={selectVisibleAccounts}
                      onDeselectVisible={deselectVisibleAccounts}
                    />
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


  );
}

function OffboardCampaignWorkspace({ controller }: { controller: OffboardCampaignController }) {
  return (
    <TabsContent value="campaigns" className="space-y-5">
      <OffboardCampaignList controller={controller} />
      <OffboardCampaignDetail controller={controller} />
    </TabsContent>
  );
}

function OffboardCampaignList({ controller }: { controller: OffboardCampaignController }) {
  const { campaigns, campaignSort, deleteDryRun, fetchCampaigns, isWorking, selectedCampaign, setCampaignSort, sortedCampaigns } = controller;
  return (
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
                              <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                                <span>by {campaign.createdBy}</span>
                                <Badge variant={campaign.workflowMode === 'direct' ? 'destructive' : 'outline'}>{campaign.workflowMode === 'direct' ? 'direct' : 'verification'}</Badge>
                              </div>
                            </button>
                          </TableCell>
                          <TableCell><OperationalStatusBadge status={campaign.status} /></TableCell>
                          <TableCell className="text-xs"><CampaignDate value={campaign.createdAt} /></TableCell>
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
  );
}

function OffboardCampaignDetail({ controller }: { controller: OffboardCampaignController }) {
  if (!controller.selectedCampaign) return null;
  return (
    <div className="space-y-4">
      <OffboardCampaignSummary controller={controller} />
      <OffboardCampaignDetailTabs controller={controller} />
    </div>
  );
}

function OffboardCampaignSummary({ controller }: { controller: OffboardCampaignController }) {
  const { selectedCampaign, stats } = controller;
  if (!selectedCampaign) return null;
  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <OffboardCampaignIdentity campaign={selectedCampaign} />
        <OffboardCampaignControls controller={controller} campaign={selectedCampaign} />
      </div>
      <OffboardCampaignStats stats={stats} />
    </div>
  );
}

function OffboardCampaignIdentity({ campaign }: { campaign: CampaignDetail }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="truncate text-lg font-semibold">{campaign.name}</h3>
        <OperationalStatusBadge status={campaign.status} />
        <Badge variant={campaign.workflowMode === 'direct' ? 'destructive' : 'outline'}>
          {campaign.workflowMode === 'direct' ? 'direct offboarding' : 'verification campaign'}
        </Badge>
        {campaign.executionPaused && <Badge variant="outline">execution paused</Badge>}
        {campaign.sendingPaused && <Badge variant="outline">sending paused</Badge>}
        {campaign.remindersPaused && <Badge variant="outline">reminders paused</Badge>}
        {campaign.enforcementPaused && <Badge variant="outline">enforcement paused</Badge>}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Wave {campaign.currentWave} - size {campaign.waveSize} - canary {campaign.canarySize} - pause gates {campaign.pauseAfterEachWave ? 'on' : 'off'}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        {campaign.workflowMode === 'direct'
          ? `Reference ${campaign.directOffboardReference || '-'} · ${campaign.directOffboardReason || 'No reason recorded'}`
          : 'Enforced recipients are marked offboarded so they can submit a new request unless their email is on the block list.'}
      </p>
    </div>
  );
}

function OffboardCampaignControls({ controller, campaign }: { controller: OffboardCampaignController; campaign: CampaignDetail }) {
  if (campaign.status === 'dry_run') return <OffboardDryRunControls controller={controller} campaign={campaign} />;
  if (campaign.status === 'active') return <OffboardActiveCampaignControls controller={controller} campaign={campaign} />;
  return null;
}

function OffboardDryRunControls({ controller, campaign }: { controller: OffboardCampaignController; campaign: CampaignDetail }) {
  const { activateCampaign, canExecuteDirect, deleteDryRun, isWorking } = controller;
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" onClick={activateCampaign} disabled={isWorking || (campaign.workflowMode === 'direct' && !canExecuteDirect)} className="gap-2"><Play className="h-4 w-4" />Activate</Button>
      <Button size="sm" variant="outline" onClick={() => deleteDryRun(campaign)} disabled={isWorking} className="gap-2"><Trash2 className="h-4 w-4" />Delete Dry Run</Button>
    </div>
  );
}

function OffboardActiveCampaignControls({ controller, campaign }: { controller: OffboardCampaignController; campaign: CampaignDetail }) {
  const { canExecuteDirect, controlCampaign, isWorking, openProcessAll } = controller;
  return (
    <div className="flex flex-wrap gap-2">
      <div className="flex items-center gap-1">
        <Button size="sm" onClick={openProcessAll} disabled={isWorking || (campaign.workflowMode === 'direct' && !canExecuteDirect)} className="gap-2"><ListChecks className="h-4 w-4" />Process All</Button>
        <InfoTip label="What runs">{campaign.workflowMode === 'direct' ? 'Preview the current reviewed wave before disabling AD, revoking VPN and sessions, and sending the completion notice.' : 'Preview pending initial emails, reminders currently due, and expired accounts ready for AD/VPN enforcement. Reminder dates are evaluated only when Process All or the external scheduler runs.'}</InfoTip>
      </div>
      {campaign.workflowMode === 'direct'
        ? <Button size="sm" variant="outline" onClick={() => controlCampaign(campaign.executionPaused ? 'resume_execution' : 'pause_execution')} disabled={isWorking || !canExecuteDirect} className="gap-2">{campaign.executionPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}{campaign.executionPaused ? 'Resume Direct Wave' : 'Pause Direct Work'}</Button>
        : <OffboardVerificationCampaignControls controller={controller} campaign={campaign} />}
      <Button size="sm" variant="destructive" onClick={() => controlCampaign('emergency_stop')} disabled={isWorking} className="gap-2"><Ban className="h-4 w-4" />Emergency Stop</Button>
      <Button size="sm" variant="outline" onClick={() => controlCampaign('cancel')} disabled={isWorking}>Cancel</Button>
    </div>
  );
}

function OffboardVerificationCampaignControls({ controller, campaign }: { controller: OffboardCampaignController; campaign: CampaignDetail }) {
  const { controlCampaign, isWorking, openExtension } = controller;
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => openExtension(null)} disabled={isWorking} className="gap-2"><CalendarClock className="h-4 w-4" />Extend Campaign</Button>
      <Button size="sm" variant="outline" onClick={() => controlCampaign(campaign.sendingPaused ? 'resume_wave' : 'pause_sending')} disabled={isWorking} className="gap-2">{campaign.sendingPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}{campaign.sendingPaused ? 'Resume Wave' : 'Pause Sending'}</Button>
      <Button size="sm" variant="outline" onClick={() => controlCampaign(campaign.remindersPaused ? 'resume_reminders' : 'pause_reminders')} disabled={isWorking}>{campaign.remindersPaused ? 'Resume Reminders' : 'Pause Reminders'}</Button>
      <Button size="sm" variant="outline" onClick={() => controlCampaign(campaign.enforcementPaused ? 'resume_enforcement' : 'pause_enforcement')} disabled={isWorking}>{campaign.enforcementPaused ? 'Resume Enforcement' : 'Pause Enforcement'}</Button>
    </>
  );
}

function OffboardCampaignStats({ stats }: { stats: Array<(string | number)[]> }) {
  return <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">{stats.map(([label, value]) => <div key={label} className="rounded-md border bg-muted/20 p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>)}</div>;
}

function OffboardCampaignDetailTabs({ controller }: { controller: OffboardCampaignController }) {
  const { allExtendableRecipientsSelected, canExecuteDirect, executeRollback, exportUrl, isWorking, loadRollbackPreview, logPage, logPageSize, logSort, logTotalCount, logTotalPages, logs, openExtension, recipientSort, reconcileEnforcement, reconcileFinalNotice, retryExtensionNotification, rollbackPreview, rollbackSort, selectedCampaign, selectedRecipientIds, setLogPage, setLogPageSize, setLogSort, setRecipientSort, setRollbackSort, setSelectedRecipientIds, sortedRecipients, sortedRollbackItems, extendableRecipientIds } = controller;
  if (!selectedCampaign) return null;
  return (
                    <Tabs defaultValue="recipients">
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <TabsList>
                          <TabsTrigger value="recipients">Recipients</TabsTrigger>
                          <TabsTrigger value="logs">Logs</TabsTrigger>
                          {selectedCampaign.workflowMode !== 'direct' && <TabsTrigger value="rollback">Rollback</TabsTrigger>}
                        </TabsList>
                        <div className="flex flex-wrap gap-2">
                          {selectedCampaign.status === 'active' && selectedCampaign.workflowMode === 'verification' && (
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

                      <OffboardRecipientsTable
                        campaign={selectedCampaign}
                        recipients={sortedRecipients}
                        sort={recipientSort}
                        selectedIds={selectedRecipientIds}
                        allExtendableSelected={allExtendableRecipientsSelected}
                        extendableIds={extendableRecipientIds}
                        working={isWorking}
                        canExecuteDirect={canExecuteDirect}
                        onSort={key => setRecipientSort(nextSort(recipientSort, key))}
                        onSelectionChange={setSelectedRecipientIds}
                        onRetryExtension={retryExtensionNotification}
                        onReconcileEnforcement={reconcileEnforcement}
                        onReconcileFinalNotice={reconcileFinalNotice}
                      />

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
                                <TableCell className="text-xs"><CampaignDate value={log.createdAt} /></TableCell>
                                <TableCell><OperationalStatusBadge status={log.level} /></TableCell>
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

                      {selectedCampaign.workflowMode !== 'direct' && <TabsContent value="rollback" className="space-y-4 rounded-lg border p-4">
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
                            <OffboardRollbackPreviewTable
                              items={sortedRollbackItems}
                              sort={rollbackSort}
                              onSort={key => setRollbackSort(nextSort(rollbackSort, key))}
                            />
                          </div>
                        ) : (
                          <p className="text-sm text-muted-foreground">Preview rollback before executing. Conflicts require manual review and are not changed.</p>
                        )}
                      </TabsContent>}
                    </Tabs>
  );
}

function OffboardConfirmationDialogs({ controller }: { controller: OffboardCampaignController }) {
  return (
    <>
      <OffboardActivationDialog controller={controller} />
      <OffboardRollbackDialog controller={controller} />
    </>
  );
}

function OffboardActivationDialog({ controller }: { controller: OffboardCampaignController }) {
  const { activationDialogOpen, dispatchActivationDraft } = controller;
  return <OffboardActivationImpact controller={controller} open={activationDialogOpen} onOpenChange={open => { if (!open) dispatchActivationDraft({ type: 'close' }); }} />;
}

function OffboardActivationImpact({ controller, open, onOpenChange }: { controller: OffboardCampaignController; open: boolean; onOpenChange: (open: boolean) => void }) {
  const { activationPreview, directAcknowledgement, directIrreversibleAcknowledgement, dispatchActivationDraft, executeActivation, isWorking, selectedCampaign } = controller;
  const direct = selectedCampaign?.workflowMode === 'direct';
  const executable = activationPreview?.summary.executable || 0;
  const acknowledgement = `DIRECT OFFBOARD ${executable} ${executable === 1 ? 'ACCOUNT' : 'ACCOUNTS'}`;
  return (
    <ActionImpactDialog
      open={open}
      onOpenChange={onOpenChange}
      title={direct ? 'Activate reviewed direct offboarding' : 'Activate offboard campaign'}
      description={direct ? 'This begins reviewed access removal in waves. It cannot be rolled back; future access requires a new request.' : 'This releases only the reviewed first wave. The server rechecks preview scope before it queues any delivery.'}
      items={activationImpactItems(selectedCampaign, activationPreview)}
      evidence={<OffboardActivationEvidence controller={controller} />}
      input={direct ? { label: `Type ${acknowledgement}`, required: true } : undefined}
      inputValue={directAcknowledgement}
      onInputValueChange={value => dispatchActivationDraft({ type: 'setAcknowledgement', value })}
      confirmDisabled={Boolean(direct && (!directIrreversibleAcknowledgement || directAcknowledgement !== acknowledgement))}
      confirmLabel={direct ? 'Begin direct offboarding' : 'Activate and release first wave'}
      working={isWorking}
      destructive
      onConfirm={executeActivation}
    />
  );
}

function activationImpactItems(campaign: CampaignDetail | null, preview: OperationPreview | null) {
  const direct = campaign?.workflowMode === 'direct';
  return [
    { label: 'Campaign', value: campaign?.name || '-' },
    { label: 'Scope', value: `${preview?.summary.executable || 0} executable recipient${preview?.summary.executable === 1 ? '' : 's'}` },
    { label: 'External effects', value: direct ? 'Disable AD, revoke linked VPN and sessions, mark the request offboarded, then send the completed-offboarding notice.' : 'Sends initial verification email; enforcement remains scheduled by campaign deadline.' },
    { label: 'Deletion', value: direct ? 'No AD object or VPN record is deleted. Permanent deletion remains manual in Account Lifecycle.' : 'Not part of campaign activation.' },
    { label: 'Reversibility', value: direct ? 'Direct offboarding cannot be rolled back. Future access requires a new account request.' : 'Use exact rollback preview; live-state conflicts are not overwritten.' },
  ];
}

function OffboardActivationEvidence({ controller }: { controller: OffboardCampaignController }) {
  const { activationPreview, directIrreversibleAcknowledgement, dispatchActivationDraft, selectedCampaign } = controller;
  if (!activationPreview) return null;
  return (
    <div className="space-y-3">
      <p>Exact preview {activationPreview.previewId} expires <CampaignDate value={activationPreview.expiresAt} />. The server rechecks live LDAP/VPN/request state before claiming execution.{activationPreview.downloadUrl && <> <a className="underline" href={activationPreview.downloadUrl}>Download exact set</a>.</>}</p>
      {selectedCampaign?.workflowMode === 'direct' && <label className="flex items-start gap-2 text-foreground"><Checkbox checked={directIrreversibleAcknowledgement} onCheckedChange={checked => dispatchActivationDraft({ type: 'setIrreversibleAcknowledgement', value: Boolean(checked) })} /><span>I understand this immediately removes access and sends the account holder a completed-offboarding notice.</span></label>}
    </div>
  );
}

function OffboardRollbackDialog({ controller }: { controller: OffboardCampaignController }) {
  const { executeRollback, isWorking, rollbackDialogOpen, rollbackPreview, selectedCampaign, setRollbackDialogOpen } = controller;
  return (
    <ActionImpactDialog
      open={rollbackDialogOpen}
      onOpenChange={setRollbackDialogOpen}
      title="Execute exact rollback scope"
      description="Rollback only performs the actions from this reviewed snapshot. It preserves live safety checks; rows that changed after enforcement are marked for reconciliation instead of being replayed."
      items={[
        { label: 'Campaign', value: selectedCampaign?.name || '-' },
        { label: 'Rollback scope', value: `${rollbackPreview?.rollbackable || 0} recipient${rollbackPreview?.rollbackable === 1 ? '' : 's'}` },
        { label: 'Conflicts', value: `${rollbackPreview?.conflicts || 0} unchanged`, tone: rollbackPreview?.conflicts ? 'warning' : 'default' },
        { label: 'External effects', value: 'May enable AD accounts and restore VPN access where the live state proves this campaign made the change.' },
        { label: 'Evidence', value: 'Per-recipient outcomes and lifecycle action idempotency keys are retained.' },
      ]}
      evidence={rollbackPreview ? <span>Exact preview {rollbackPreview.previewId} expires <CampaignDate value={rollbackPreview.expiresAt} />. Stale or expired previews cannot execute.{rollbackPreview.downloadUrl && <> <a className="underline" href={rollbackPreview.downloadUrl}>Download exact set</a>.</>}</span> : null}
      confirmLabel="Execute rollback"
      working={isWorking}
      destructive
      onConfirm={executeRollback}
    />

  );
}

function OffboardProcessAllDialog({ controller }: { controller: OffboardCampaignController }) {
  const { executeProcessAll, isWorking, processAllOpen, processAllPreview, processAllSelection, setProcessAllOpen, setProcessAllSelection } = controller;
  return (
    <Dialog open={processAllOpen} onOpenChange={setProcessAllOpen}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Process All Due Campaign Work</DialogTitle>
          <DialogDescription>
            {processAllPreview?.workflowMode === 'direct'
              ? 'Review the current direct-offboarding wave. Pauses stop new recipient claims; they cannot interrupt an external call already in progress.'
              : 'Review the live counts, choose the work categories to run, and explicitly override paused sections only for this operation. Initial sending still stops at configured wave approval gates.'}
          </DialogDescription>
        </DialogHeader>
        {processAllPreview && (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              {(processAllPreview.workflowMode === 'direct'
                ? [['directOffboarding', 'Direct Offboarding', ShieldAlert] as const]
                : [
                    ['initialEmails', 'Initial Emails', Mail] as const,
                    ['reminders', 'Due Reminders', RefreshCw] as const,
                    ['enforcement', 'Expired Enforcement', ShieldAlert] as const,
                  ]).map(([key, label, Icon]) => {
                const section = processAllPreview.sections[key];
                const selected = processAllSelection[key];
                const overrideKey = key === 'initialEmails'
                  ? 'overrideSendingPause'
                  : key === 'reminders'
                    ? 'overrideRemindersPause'
                    : key === 'directOffboarding'
                      ? 'overrideExecutionPause'
                      : 'overrideEnforcementPause';
                return (
                  <div key={key} className={`rounded-xl border p-4 ${selected ? 'border-blue-300 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/40' : 'bg-muted/20'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-blue-700 dark:text-blue-200" />
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
                          <p className="mt-2 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-2 text-xs leading-5 text-amber-900 dark:text-amber-200">
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
                    {key === 'directOffboarding' && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        AD state checks: {processAllPreview.sections.directOffboarding.adDisables} · Reviewed VPN links: {processAllPreview.sections.directOffboarding.vpnRevocations} · Session revocations: {processAllPreview.sections.directOffboarding.sessionRevocations} · Final notices after convergence: {processAllPreview.sections.directOffboarding.finalNotices}
                      </p>
                    )}
                    {section.paused && (
                      <label className="mt-3 flex items-center justify-between gap-3 rounded-md border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 p-2 text-xs text-amber-900 dark:text-amber-200">
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
              && !processAllSelection.directOffboarding
            }
            className="gap-2"
          >
            <ListChecks className="h-4 w-4" />
            Run Selected Work
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

  );
}

function OffboardExtensionDialog({ controller }: { controller: OffboardCampaignController }) {
  const { addExtensionReminder, executeExtension, extensionForm, extensionMinimumDate, extensionOpen, extensionPreview, extensionRecipientIds, isWorking, minimumExtensionReminderDate, previewExtension, setExtensionOpen, setExtensionForm, setExtensionPreview } = controller;
  return (
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
                minDate={extensionMinimumDate ?? undefined}
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
                    onClick={addExtensionReminder}
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
                {extensionForm.reminderDates.map((reminder, index) => (
                  <div key={reminder.id} className="flex min-w-0 items-start gap-2">
                    <DateTimePicker
                      value={reminder.value}
                      ariaLabel={`Reminder ${index + 1} date and time`}
                      minDate={minimumExtensionReminderDate}
                      maxDate={extensionForm.newDeadline ? new Date(extensionForm.newDeadline) : undefined}
                      placeholder={`Reminder ${index + 1}`}
                      className="min-w-0 flex-1"
                      onChange={nextValue => {
                        setExtensionPreview(null);
                        setExtensionForm(previous => ({
                          ...previous,
                          reminderDates: previous.reminderDates.map(item => item.id === reminder.id ? { ...item, value: nextValue } : item),
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
                          reminderDates: previous.reminderDates.filter(item => item.id !== reminder.id),
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
                            <TableCell><OperationalStatusBadge status={item.status} /></TableCell>
                            <TableCell>
                              {item.eligible
                                ? <Badge className="bg-green-100 dark:bg-green-950/60 text-green-800 dark:text-green-200 hover:bg-green-100 dark:bg-green-950/60">ready</Badge>
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
  );
}

export default function OffboardCampaignsPanel(props: OffboardCampaignsPanelProps) {
  const controller = useOffboardCampaignController(props);
  return <OffboardCampaignsWorkspace controller={controller} />;
}
