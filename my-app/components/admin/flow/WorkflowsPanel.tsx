'use client';
import { requestActionImpact } from '@/components/admin/actionImpactRequest';

import { useCallback, useEffect, useMemo, useReducer, useState, type ReactNode } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  Handle,
  Position,
  MarkerType,
  type Node as RFNode,
  type Edge as RFEdge,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { fetchWithCsrf } from '@/lib/csrf';
import { fetchJson } from '@/lib/client-query';
import useSWR from 'swr';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { ConditionGroupsEditor } from './WorkflowConditionGroupsEditor';
import { MonitorCredentialForm } from './MonitorCredentialForm';
import { WorkflowRunHistory } from './WorkflowRunHistory';
import { WorkflowPanelDialogs } from './WorkflowPanelDialogs';
import { WorkflowPanelSidebar } from './WorkflowPanelSidebar';
import type {
  CatalogEntry,
  ConditionGroupDraft,
  NodeConfigField,
  StoredGraph,
  StoredRun,
} from './workflowPanelTypes';

export { ConditionGroupsEditor } from './WorkflowConditionGroupsEditor';
export { MonitorCredentialForm } from './MonitorCredentialForm';
import { describeWorkflowSummary } from '@/lib/flow/describe';
import { WORKFLOW_TEMPLATES } from '@/lib/flow/templates';
import { isSeededWorkflowExample } from '@/lib/flow/publication-guard';
import {
  Loader2,
  Save,
  Rocket,
  Ban,
  Trash2,
  Plus,
  Zap,
  GitBranch,
  Clock,
  Mail,
  BellRing,
  BellOff,
  ShieldAlert,
  ShieldX,
  LifeBuoy,
  Users,
  UserMinus,
  ClipboardCheck,
  Timer,
  Sparkles,
  Pencil,
  Play,
  Activity,
  X,
  Copy,
} from 'lucide-react';
import {
  projectWorkflowNodes,
  serializeWorkflowNodes,
  type StoredWorkflowNode,
} from '@/lib/flow/designer';

interface WorkflowPanelState {
  selectedId: string | null;
  runs: StoredRun[];
  savedSignature: string;
  pendingGraphId: string | null;
  deleteOpen: boolean;
  meta: {
    name: string;
    description: string;
    status: string;
    version: number;
    enabled: boolean;
    updatedAt: string;
  };
  selectedNodeId: string | null;
}

const INITIAL_WORKFLOW_PANEL_STATE: WorkflowPanelState = {
  selectedId: null,
  runs: [],
  savedSignature: '',
  pendingGraphId: null,
  deleteOpen: false,
  meta: { name: '', description: '', status: 'draft', version: 1, enabled: false, updatedAt: '' },
  selectedNodeId: null,
};

type WorkflowPanelAction =
  | { type: 'opened'; id: string; meta: WorkflowPanelState['meta']; runs: StoredRun[]; savedSignature: string }
  | { type: 'pendingGraphChanged'; id: string | null }
  | { type: 'draftSaved'; savedSignature: string; updatedAt: string }
  | { type: 'deleted' }
  | { type: 'deleteDialogChanged'; open: boolean }
  | { type: 'selectedNodeChanged'; id: string | null };

function workflowPanelReducer(state: WorkflowPanelState, action: WorkflowPanelAction): WorkflowPanelState {
  switch (action.type) {
    case 'opened':
      return { ...state, selectedId: action.id, meta: action.meta, runs: action.runs, savedSignature: action.savedSignature, selectedNodeId: null };
    case 'pendingGraphChanged':
      return { ...state, pendingGraphId: action.id };
    case 'draftSaved':
      return { ...state, savedSignature: action.savedSignature, meta: { ...state.meta, updatedAt: action.updatedAt } };
    case 'deleted':
      return { ...state, selectedId: null, savedSignature: '', deleteOpen: false };
    case 'deleteDialogChanged':
      return { ...state, deleteOpen: action.open };
    case 'selectedNodeChanged':
      return { ...state, selectedNodeId: action.id };
  }
}

/** Pre-rendered node icons: element instances, not components, so the
 * react-hooks/static-components rule stays satisfied inside RF nodes. */
function nodeIcon(nodeType: string): ReactNode {
  if (nodeType === 'source_monitor_endpoints') return <Activity className="h-4 w-4 text-sky-600" />;
  if (nodeType.startsWith('trigger_schedule')) return <Timer className="h-4 w-4 text-muted-foreground" />;
  if (nodeType === 'trigger_lifecycle_action_completed') {
    return <ClipboardCheck className="h-4 w-4 text-muted-foreground" />;
  }
  if (nodeType === 'trigger_lifecycle_action_failed') return <ShieldX className="h-4 w-4 text-muted-foreground" />;
  if (nodeType.startsWith('trigger')) return <Zap className="h-4 w-4 text-muted-foreground" />;
  if (nodeType === 'logic_delay') return <Clock className="h-4 w-4 text-muted-foreground" />;
  if (nodeType.startsWith('logic_condition')) return <GitBranch className="h-4 w-4 text-muted-foreground" />;
  if (nodeType === 'action_send_email') return <Mail className="h-4 w-4 text-muted-foreground" />;
  if (nodeType === 'action_clear_notification_banner') return <BellOff className="h-4 w-4 text-muted-foreground" />;
  if (nodeType.startsWith('action_create_notification')) return <BellRing className="h-4 w-4 text-muted-foreground" />;
  if (nodeType.startsWith('action_create_service_alert') || nodeType.startsWith('action_resolve')) {
    return <ShieldAlert className="h-4 w-4 text-muted-foreground" />;
  }
  if (nodeType === 'action_add_ticket_response' || nodeType === 'action_close_ticket') {
    return <LifeBuoy className="h-4 w-4 text-muted-foreground" />;
  }
  if (nodeType === 'action_enqueue_group_add') return <Users className="h-4 w-4 text-muted-foreground" />;
  if (nodeType === 'action_enqueue_group_remove') return <UserMinus className="h-4 w-4 text-muted-foreground" />;
  return <Mail className="h-4 w-4 text-muted-foreground" />;
}

function paletteIcon(nodeType: string): React.ComponentType<{ className?: string }> {
  if (nodeType === 'source_monitor_endpoints') return Activity;
  if (nodeType === 'trigger_schedule') return Timer;
  if (nodeType === 'trigger_lifecycle_action_completed') return ClipboardCheck;
  if (nodeType === 'trigger_lifecycle_action_failed') return ShieldX;
  if (nodeType.startsWith('trigger')) return Zap;
  if (nodeType === 'logic_delay') return Clock;
  if (nodeType.startsWith('logic_condition')) return GitBranch;
  if (nodeType === 'action_send_email') return Mail;
  if (nodeType === 'action_clear_notification_banner') return BellOff;
  if (nodeType.startsWith('action_create_notification')) return BellRing;
  if (nodeType.startsWith('action_create_service_alert') || nodeType.startsWith('action_resolve')) return ShieldAlert;
  if (nodeType === 'action_add_ticket_response' || nodeType === 'action_close_ticket') return LifeBuoy;
  if (nodeType === 'action_enqueue_group_add') return Users;
  if (nodeType === 'action_enqueue_group_remove') return UserMinus;
  return Mail;
}

/* ------------------------------ Custom node ----------------------------- */

function FlowNodeView({ data, selected }: { data: Record<string, unknown>; selected?: boolean }) {
  const entry = data.entry as CatalogEntry | undefined;
  const handles = entry?.handles ?? [];
  const category = entry?.category ?? 'action';
  const accent =
    category === 'source'
      ? 'border-sky-500'
      : category === 'trigger'
      ? 'border-amber-400'
      : category === 'logic'
        ? 'border-violet-400'
        : 'border-emerald-400';

  return (
    <div
      className={`rounded-lg border-2 bg-card dark:bg-card shadow-sm px-3 py-2 min-w-[170px] ${accent} ${
        selected ? 'ring-2 ring-ring' : ''
      }`}
    >
      {category !== 'source' && <Handle type="target" position={Position.Left} className="!h-2 !w-2" />}
      <div className="flex items-center gap-2">
        {nodeIcon(String(data.nodeType ?? ''))}
        <span className="text-xs font-semibold">{entry?.label ?? String(data.label ?? 'Node')}</span>
      </div>
      {data.summary ? (
        <p className="mt-1 text-[10px] text-muted-foreground line-clamp-2 max-w-[200px]">{String(data.summary)}</p>
      ) : null}
      {handles.length > 0 ? (
        handles.map((handle, index) => (
          <Handle
            key={handle.id}
            id={handle.id}
            type="source"
            position={Position.Right}
            style={{ top: `${25 + index * 22}%` }}
            className="!h-2 !w-2"
          />
        ))
      ) : (
        <Handle type="source" position={Position.Right} className="!h-2 !w-2" />
      )}
    </div>
  );
}

const nodeTypes = { flow: FlowNodeView };

/* ------------------------------- Mapping -------------------------------- */

type DraftNode = StoredWorkflowNode;

interface DraftEdge {
  id: string;
  source: string;
  sourceHandle?: string | null;
  target: string;
}

function toRfNodes(draftNodes: unknown, catalogByType: Map<string, CatalogEntry>): RFNode[] {
  return projectWorkflowNodes(
    draftNodes,
    summarize,
    (nodeType) => catalogByType.get(nodeType),
  ) as RFNode[];
}

function summarize(node: DraftNode, entry?: CatalogEntry): string {
  if (!entry) return '';
  const parts: unknown[] = [];
  for (const field of entry.configSchema) {
    const value = node.config?.[field.name];
    if (value !== undefined && value !== null && String(value).trim() !== '') parts.push(value);
  }
  return parts.slice(0, 2).map((value) => String(value).slice(0, 40)).join(' · ');
}

function toDraft(nodes: RFNode[], edges: RFEdge[]): { nodes: DraftNode[]; edges: DraftEdge[] } {
  return {
    nodes: serializeWorkflowNodes(nodes.map((node) => ({
      id: node.id,
      position: node.position,
      data: {
        nodeType: String(node.data.nodeType),
        config: ((node.data.config ?? {}) as Record<string, unknown>),
        summary: String(node.data.summary ?? ''),
      },
    }))),
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      sourceHandle: edge.sourceHandle ?? null,
      target: edge.target,
    })),
  };
}

const TICKET_CATEGORY_OPTIONS = [
  { value: 'ACCOUNT', label: 'Account Issue' },
  { value: 'INFRASTRUCTURE', label: 'Infrastructure Issue' },
  { value: 'SDC', label: 'SDC (Student Data Center)' },
  { value: 'SOC', label: 'SOC (Security Operations Center)' },
];

const TICKET_SEVERITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

const TICKET_STATUS_OPTIONS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'closed', label: 'Closed' },
];

/**
 * The condition node's "equals" control adapts to the chosen field: picking
 * "Ticket category" offers the category list, group fields offer the group
 * picker, booleans offer true/false - no free-text guessing required.
 */
function resolveEffectiveField(
  entry: CatalogEntry,
  config: Record<string, unknown>,
  field: NodeConfigField
): NodeConfigField {
  if (entry.type !== 'logic_condition' || field.name !== 'equals') return field;
  const contextField = String(config.field ?? '');
  switch (contextField) {
    case 'category':
      return { ...field, kind: 'select', options: TICKET_CATEGORY_OPTIONS, placeholder: undefined, help: 'Compare against the ticket topic.' };
    case 'severity':
      return { ...field, kind: 'select', options: TICKET_SEVERITY_OPTIONS, placeholder: undefined, help: 'Compare against the submitted severity.' };
    case 'status':
    case 'newStatus':
      return { ...field, kind: 'select', options: TICKET_STATUS_OPTIONS, placeholder: undefined, help: undefined };
    case 'requestedForSelf':
    case 'joinAutoApprove':
      return { ...field, kind: 'select', options: [{ value: 'true', label: 'true' }, { value: 'false', label: 'false' }], placeholder: undefined, help: 'Boolean comparison.' };
    case 'requestedForGroupDn':
    case 'joinGroupDn':
      return { ...field, kind: 'group-dn', placeholder: undefined, help: 'Pick the group to compare against.' };
    default:
      return field;
  }
}

/* --------------------------- Condition groups ---------------------------- */

interface MonitorCredentialOption {
  id: string;
  name: string;
  kind: string;
  allowedHosts: string[];
  enabled: boolean;
}

export interface MonitorCredentialDraft {
  name: string;
  kind: string;
  username: string;
  headerName: string;
  secret: string;
  hosts: string;
}

interface MonitorCheckDraft {
  key: string;
  name: string;
  kind: 'http' | 'https' | 'tcp' | 'tls' | 'ldaps' | 'icmp';
  host: string;
  port?: number;
  path?: string;
  method?: 'GET' | 'HEAD';
  expectedStatusMin?: number;
  expectedStatusMax?: number;
  expectedBody?: string;
  baseDn?: string;
  credentialRef?: string;
  legacyEndpointId?: string;
  intervalSeconds: number;
  timeoutMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
  enabled: boolean;
}

interface LegacyMonitorTarget {
  id: string;
  name: string;
  protocol: string;
  host: string;
  port: number;
  path: string | null;
  timeoutMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
  enabled: boolean;
  currentState: string;
}

const MONITOR_DEFAULT_PORT: Record<MonitorCheckDraft['kind'], number | undefined> = {
  http: 80,
  https: 443,
  tcp: 443,
  tls: 443,
  ldaps: 636,
  icmp: undefined,
};

function MonitorChecksEditor({
  checks,
  credentials,
  onChange,
}: {
  checks: MonitorCheckDraft[];
  credentials: MonitorCredentialOption[];
  onChange: (checks: MonitorCheckDraft[]) => void;
}) {
  const [testing, setTesting] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, string>>({});
  const [legacyTargets, setLegacyTargets] = useState<LegacyMonitorTarget[] | null>(null);
  const update = (index: number, patch: Partial<MonitorCheckDraft>) =>
    onChange(checks.map((check, checkIndex) => checkIndex === index ? { ...check, ...patch } : check));
  const add = () => {
    const suffix = Date.now().toString(36);
    onChange([...checks, {
      key: `check_${suffix}`,
      name: 'New service check',
      kind: 'https',
      host: '',
      port: 443,
      path: '/',
      method: 'GET',
      expectedStatusMin: 200,
      expectedStatusMax: 499,
      intervalSeconds: 60,
      timeoutMs: 5000,
      failureThreshold: 2,
      recoveryThreshold: 2,
      enabled: true,
    }]);
  };
  const loadLegacy = async (): Promise<LegacyMonitorTarget[]> => {
    const response = await fetch('/api/admin/monitoring-targets');
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'Legacy checks could not be loaded');
    const targets = Array.isArray(body.targets) ? body.targets as LegacyMonitorTarget[] : [];
    setLegacyTargets(targets);
    return targets;
  };
  const importLegacy = async () => {
    try {
      const targets = legacyTargets ?? await loadLegacy();
      const imported: MonitorCheckDraft[] = targets.slice(0, Math.max(0, 25 - checks.length)).map((target) => ({
      key: `legacy_${String(target.id).replace(/[^a-z0-9_-]/gi, '_').slice(-48)}`,
      legacyEndpointId: String(target.id),
      name: String(target.name || 'Imported check'),
      kind: target.protocol === 'tcp' ? 'tcp' : 'https',
      host: String(target.host || ''),
      port: Number(target.port) || (target.protocol === 'tcp' ? 443 : 443),
      ...(target.protocol === 'https' ? { path: String(target.path || '/'), method: 'GET' as const, expectedStatusMin: 200, expectedStatusMax: 499 } : {}),
      intervalSeconds: 60,
      timeoutMs: Number(target.timeoutMs) || 5000,
      failureThreshold: Number(target.failureThreshold) || 2,
      recoveryThreshold: Number(target.recoveryThreshold) || 2,
      enabled: target.enabled !== false,
      }));
      const existingKeys = new Set(checks.map((check) => check.key));
      onChange([...checks, ...imported.filter((check) => !existingKeys.has(check.key))].slice(0, 25));
      setResults((current) => ({ ...current, __import: `Imported ${imported.length} legacy check${imported.length === 1 ? '' : 's'} into this draft. Legacy monitoring remains active until this replacement is published and activated.` }));
    } catch (error) {
      setResults((current) => ({ ...current, __import: error instanceof Error ? error.message : 'Legacy checks could not be loaded' }));
    }
  };
  const test = async (check: MonitorCheckDraft) => {
    setTesting(check.key);
    try {
      const response = await fetchWithCsrf('/api/admin/workflow-monitor-checks/test', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(check),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Check failed');
      setResults((current) => ({
        ...current,
        [check.key]: body.result.reachable ? `Online · ${body.result.latencyMs} ms` : `Offline · ${body.result.error || 'No response'}`,
      }));
    } catch (error) {
      setResults((current) => ({ ...current, [check.key]: error instanceof Error ? error.message : 'Check failed' }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 border-b pb-3">
        <div>
          <p className="text-sm font-semibold">Checks in this source</p>
          <p className="text-xs text-muted-foreground">Each check keeps its own state and routes through Failed or Recovered.</p>
        </div>
        <div className="flex shrink-0 gap-2"><Button type="button" size="sm" variant="ghost" onClick={() => void importLegacy()} disabled={checks.length >= 25}>Import legacy</Button><Button type="button" size="sm" variant="outline" onClick={add} disabled={checks.length >= 25}><Plus className="h-3.5 w-3.5" /> Add check</Button></div>
      </div>
      {results.__import && <p className="border-l-2 border-sky-500 bg-sky-500/5 px-3 py-2 text-xs text-muted-foreground">{results.__import}</p>}
      <details
        className="border-l-2 border-muted-foreground/40 bg-muted/10 px-3 py-2"
        onToggle={(event) => {
          if (event.currentTarget.open && legacyTargets === null) {
            void loadLegacy().catch((error) => setResults((current) => ({
              ...current,
              __import: error instanceof Error ? error.message : 'Legacy checks could not be loaded',
            })));
          }
        }}
      >
        <summary className="cursor-pointer text-xs font-medium">
          Legacy monitors {legacyTargets ? `· ${legacyTargets.length}` : ''}
        </summary>
        <div className="mt-2 space-y-2 border-t pt-2">
          {legacyTargets === null && <p className="text-xs text-muted-foreground">Loading legacy monitor inventory…</p>}
          {legacyTargets?.length === 0 && <p className="text-xs text-muted-foreground">No legacy monitors remain.</p>}
          {legacyTargets?.map((target) => (
            <div key={target.id} className="grid gap-1 text-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div className="min-w-0">
                <p className="truncate font-medium">{target.name}</p>
                <p className="truncate font-mono text-[11px] text-muted-foreground">{target.protocol.toUpperCase()} · {target.host}:{target.port}{target.path ?? ''}</p>
              </div>
              <span className="text-muted-foreground">{target.enabled ? target.currentState : 'disabled'}</span>
            </div>
          ))}
          <p className="text-[11px] text-muted-foreground">Read-only compatibility inventory. Import copies these checks into this source; activation retires exact unchanged matches atomically.</p>
        </div>
      </details>
      {checks.length === 0 && (
        <button type="button" onClick={add} className="w-full border border-dashed p-5 text-left text-sm text-muted-foreground hover:border-sky-500 hover:text-foreground">
          Add the first endpoint. Nothing is scheduled until this workflow version is published and active.
        </button>
      )}
      {checks.map((check, index) => {
        const httpCheck = check.kind === 'http' || check.kind === 'https';
        const credentialOptions = credentials.filter((credential) => credential.enabled && (
          check.kind === 'ldaps' ? credential.kind === 'ldap_bind' : httpCheck && credential.kind !== 'ldap_bind'
        ));
        return (
          <section key={check.key} className="border-l-2 border-sky-500 bg-muted/15 p-3">
            <div className="mb-3 flex items-start gap-2">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-sky-500" />
              <div className="min-w-0 flex-1">
                <Input className="h-8 font-medium" value={check.name} onChange={(event) => update(index, { name: event.target.value })} />
                <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{check.host || 'Host not set'}{check.port ? `:${check.port}` : ''} · {check.key}</p>
              </div>
              <Button type="button" size="icon-sm" variant="ghost" onClick={() => onChange(checks.filter((_, checkIndex) => checkIndex !== index))} aria-label={`Remove ${check.name}`}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="space-y-1 text-xs"><span className="font-medium">Method</span><select className="flex h-8 w-full border bg-background px-2" value={check.kind} onChange={(event) => { const kind = event.target.value as MonitorCheckDraft['kind']; update(index, { kind, port: MONITOR_DEFAULT_PORT[kind], credentialRef: undefined }); }}><option value="https">HTTPS request</option><option value="http">HTTP request</option><option value="tcp">TCP connect</option><option value="tls">TLS handshake</option><option value="ldaps">LDAPS</option><option value="icmp">ICMP echo</option></select></label>
              <label className="space-y-1 text-xs"><span className="font-medium">Host</span><Input className="h-8 font-mono text-xs" value={check.host} onChange={(event) => update(index, { host: event.target.value })} placeholder="service.example.edu" /></label>
              {check.kind !== 'icmp' && <label className="space-y-1 text-xs"><span className="font-medium">Port</span><Input className="h-8" type="number" min={1} max={65535} value={check.port ?? ''} onChange={(event) => update(index, { port: Number(event.target.value) })} /></label>}
              {httpCheck && <label className="space-y-1 text-xs"><span className="font-medium">Path</span><Input className="h-8 font-mono text-xs" value={check.path ?? '/'} onChange={(event) => update(index, { path: event.target.value })} /></label>}
              {httpCheck && <label className="space-y-1 text-xs"><span className="font-medium">Request</span><select className="flex h-8 w-full border bg-background px-2" value={check.method ?? 'GET'} onChange={(event) => update(index, { method: event.target.value === 'HEAD' ? 'HEAD' : 'GET' })}><option value="GET">GET</option><option value="HEAD">HEAD</option></select></label>}
              {httpCheck && <label className="space-y-1 text-xs"><span className="font-medium">Expected status</span><div className="flex items-center gap-1"><Input className="h-8" type="number" value={check.expectedStatusMin ?? 200} onChange={(event) => update(index, { expectedStatusMin: Number(event.target.value) })} /><span>–</span><Input className="h-8" type="number" value={check.expectedStatusMax ?? 499} onChange={(event) => update(index, { expectedStatusMax: Number(event.target.value) })} /></div></label>}
              {httpCheck && check.method !== 'HEAD' && <label className="space-y-1 text-xs sm:col-span-2"><span className="font-medium">Response contains <span className="font-normal text-muted-foreground">(optional)</span></span><Input className="h-8" value={check.expectedBody ?? ''} onChange={(event) => update(index, { expectedBody: event.target.value || undefined })} /></label>}
              {check.kind === 'ldaps' && <label className="space-y-1 text-xs sm:col-span-2"><span className="font-medium">Base DN <span className="font-normal text-muted-foreground">(optional read check)</span></span><Input className="h-8 font-mono text-xs" value={check.baseDn ?? ''} onChange={(event) => update(index, { baseDn: event.target.value || undefined })} /></label>}
              {(httpCheck || check.kind === 'ldaps') && <label className="space-y-1 text-xs sm:col-span-2"><span className="font-medium">Credential</span><select className="flex h-8 w-full border bg-background px-2" value={check.credentialRef ?? ''} onChange={(event) => update(index, { credentialRef: event.target.value || undefined })}><option value="">No credential</option>{credentialOptions.map((credential) => <option key={credential.id} value={credential.id}>{credential.name} · {credential.allowedHosts.join(', ')}</option>)}</select>{check.kind === 'http' && check.credentialRef && <span className="text-destructive">Credentials require HTTPS.</span>}</label>}
              <label className="space-y-1 text-xs"><span className="font-medium">Every</span><select className="flex h-8 w-full border bg-background px-2" value={check.intervalSeconds} onChange={(event) => update(index, { intervalSeconds: Number(event.target.value) })}><option value={60}>1 minute</option><option value={300}>5 minutes</option><option value={900}>15 minutes</option><option value={3600}>1 hour</option></select></label>
              <label className="space-y-1 text-xs"><span className="font-medium">Timeout</span><Input className="h-8" type="number" min={500} max={15000} step={500} value={check.timeoutMs} onChange={(event) => update(index, { timeoutMs: Number(event.target.value) })} /></label>
              <label className="space-y-1 text-xs"><span className="font-medium">Fail after</span><Input className="h-8" type="number" min={1} max={10} value={check.failureThreshold} onChange={(event) => update(index, { failureThreshold: Number(event.target.value) })} /></label>
              <label className="space-y-1 text-xs"><span className="font-medium">Recover after</span><Input className="h-8" type="number" min={1} max={10} value={check.recoveryThreshold} onChange={(event) => update(index, { recoveryThreshold: Number(event.target.value) })} /></label>
            </div>
            <div className="mt-3 flex items-center justify-between border-t pt-2">
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={check.enabled} onChange={(event) => update(index, { enabled: event.target.checked })} /> Enabled in this source</label>
              <div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">{results[check.key]}</span><Button type="button" size="sm" variant="outline" disabled={testing === check.key || !check.host} onClick={() => void test(check)}>{testing === check.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Test</Button></div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

/* -------------------------------- Panel ---------------------------------- */

function useWorkflowsPanelView() {
  const [graphs, setGraphs] = useState<StoredGraph[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [panelState, dispatchPanel] = useReducer(workflowPanelReducer, INITIAL_WORKFLOW_PANEL_STATE);
  const { selectedId, runs, savedSignature, pendingGraphId, deleteOpen, meta, selectedNodeId } = panelState;
  const [nodes, setNodes, onNodesChange] = useNodesState<RFNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<RFEdge>([]);

  const catalogByType = useMemo(() => new Map(catalog.map((entry) => [entry.type, entry])), [catalog]);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId);
  const selectedEntry = selectedNode ? catalogByType.get(String(selectedNode.data.nodeType)) : undefined;
  const currentSignature = useMemo(
    () => JSON.stringify({ ...toDraft(nodes, edges), description: meta.description }),
    [edges, meta.description, nodes]
  );
  const isDirty = !!selectedId && meta.status === 'draft' && savedSignature !== currentSignature;

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [isDirty]);

  // Typed context registry of the graph's trigger: the only fields a
  // condition comparison may reference (dropdown-driven, no free text).
  const triggerContextFields = useMemo(() => {
    if (!selectedEntry || selectedEntry.type !== 'logic_condition') return [];
    const triggerNode = nodes.find(
      (node) => {
        const category = catalogByType.get(String(node.data.nodeType))?.category;
        return category === 'trigger' || category === 'source';
      }
    );
    return triggerNode ? catalogByType.get(String(triggerNode.data.nodeType))?.contextFields ?? [] : [];
  }, [nodes, catalogByType, selectedEntry]);

  const conditionGroupsActive =
    !!selectedEntry &&
    selectedEntry.type === 'logic_condition' &&
    Array.isArray((selectedNode?.data.config as Record<string, unknown> | undefined)?.groups);

  // Exact automation-eligible directory catalog. This intentionally does not
  // use the end-user join picker, whose membership filtering is a different
  // policy boundary.
  const [groupOptions, setGroupOptions] = useState<ComboboxOption[]>([]);
  const [monitorCredentials, setMonitorCredentials] = useState<MonitorCredentialOption[]>([]);
  const [credentialDraft, setCredentialDraft] = useState<MonitorCredentialDraft>({ name: '', kind: 'bearer', username: '', headerName: '', secret: '', hosts: '' });
  const [credentialBusy, setCredentialBusy] = useState(false);
  const [recovery, setRecovery] = useState<{
    timers: Array<{ id: string; nodeId: string; attempts: number; lastError: string | null; run: { graph: { name: string; version: number } } }>;
    emailAttempts: Array<{ id: string; nodeId: string; kind: string; status: string; attempts: number; lastError: string | null }>;
    providerLogouts: Array<{ id: string; username: string; reason: string; attempts: number; lastError: string | null }>;
  }>({ timers: [], emailAttempts: [], providerLogouts: [] });
  useSWR<{ groups?: Array<{ dn: string; label: string; policy?: string }> }>('/api/admin/workflow-groups', fetchJson, {
    onSuccess: (data) => {
      const seen = new Set<string>();
      const options: ComboboxOption[] = [];
      for (const group of data.groups ?? []) {
        if (seen.has(group.dn)) continue;
        seen.add(group.dn);
        options.push({ value: group.dn, label: group.label, meta: group.policy });
      }
      setGroupOptions(options);
    },
  });

  const loadMonitorCredentials = useCallback(async () => {
    const response = await fetch('/api/admin/monitor-credentials');
    if (!response.ok) return;
    const data = await response.json();
    setMonitorCredentials(data.credentials ?? []);
  }, []);
  useSWR<{ credentials?: MonitorCredentialOption[] }>('/api/admin/monitor-credentials', fetchJson, {
    onSuccess: (data) => setMonitorCredentials(data.credentials ?? []),
  });

  const loadRecovery = useCallback(async () => {
    const response = await fetch('/api/admin/workflow-recovery');
    if (!response.ok) return;
    const data = await response.json();
    setRecovery({ timers: data.timers ?? [], emailAttempts: data.emailAttempts ?? [], providerLogouts: data.providerLogouts ?? [] });
  }, []);
  useSWR<{ timers?: typeof recovery.timers; emailAttempts?: typeof recovery.emailAttempts; providerLogouts?: typeof recovery.providerLogouts }>('/api/admin/workflow-recovery', fetchJson, {
    onSuccess: (data) => setRecovery({ timers: data.timers ?? [], emailAttempts: data.emailAttempts ?? [], providerLogouts: data.providerLogouts ?? [] }),
  });

  const reconcileWorkflowOperation = async (
    kind: 'timer' | 'action_attempt' | 'email_attempt' | 'provider_logout',
    id: string,
    resolution: 'not_executed' | 'not_delivered' | 'retry_authorized'
  ) => {
    const evidence = window.prompt(
      kind === 'timer' ? 'Enter evidence that the downstream timer action did not execute.'
        : kind === 'email_attempt' ? 'Enter provider evidence that the email was not delivered.'
          : kind === 'action_attempt' ? 'Enter external-system evidence that this action did not execute.'
            : 'Enter identity-provider evidence authorizing an idempotent logout retry.'
    )?.trim();
    if (!evidence) return;
    setBusy(`recovery:${id}`);
    try {
      const response = await fetchWithCsrf('/api/admin/workflow-recovery', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, id, resolution, evidence }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Recovery failed');
      await loadRecovery();
      setMessage({ ok: true, text: 'Recovery authorization recorded with evidence.' });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Recovery failed' });
    } finally {
      setBusy(null);
    }
  };

  const createMonitorCredential = async () => {
    setCredentialBusy(true); setMessage(null);
    try {
      const response = await fetchWithCsrf('/api/admin/monitor-credentials', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: credentialDraft.name, kind: credentialDraft.kind, username: credentialDraft.username || undefined,
          headerName: credentialDraft.headerName || undefined, secret: credentialDraft.secret,
          allowedHosts: credentialDraft.hosts.split(/[\n,]/).map((host) => host.trim()).filter(Boolean),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to create monitor credential');
      setCredentialDraft({ name: '', kind: 'bearer', username: '', headerName: '', secret: '', hosts: '' });
      await loadMonitorCredentials(); setMessage({ ok: true, text: 'Monitor credential created. Secret values are write-only.' });
    } catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : 'Failed to create monitor credential' }); }
    finally { setCredentialBusy(false); }
  };

  const loadList = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/workflows');
      if (!res.ok) throw new Error('Failed to load workflows');
      const data = await res.json();
      setGraphs(data.graphs ?? []);
      setCatalog(data.catalog ?? []);
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Failed to load workflows' });
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    loadList().finally(() => setLoading(false));
  }, [loadList]);

  const openGraph = useCallback(
    async (id: string) => {
      try {
        const res = await fetch(`/api/admin/workflows/${id}`);
        if (!res.ok) throw new Error('Failed to open workflow');
        const data = await res.json();
        const graph = data.graph as StoredGraph & { runs: StoredRun[] };
        const nextMeta = {
          name: graph.name,
          description: graph.description ?? '',
          status: graph.status,
          version: graph.version,
          enabled: graph.enabled,
          updatedAt: graph.updatedAt,
        };
        const draftNodes = toRfNodes(graph.nodes, catalogByType);
        const draftEdges = ((graph.edges ?? []) as DraftEdge[]).map((edge) => ({
          id: edge.id,
          source: edge.source,
          sourceHandle: edge.sourceHandle ?? undefined,
          target: edge.target,
          animated: false,
          markerEnd: { type: MarkerType.ArrowClosed },
        }));
        setNodes(draftNodes);
        setEdges(draftEdges);
        dispatchPanel({
          type: 'opened',
          id: graph.id,
          meta: nextMeta,
          runs: graph.runs ?? [],
          savedSignature: JSON.stringify({
            ...toDraft(draftNodes, draftEdges),
            description: graph.description ?? '',
          }),
        });
        setMessage(null);
      } catch (error) {
        setMessage({ ok: false, text: error instanceof Error ? error.message : 'Failed to open workflow' });
      }
    },
    [catalogByType, setEdges, setNodes]
  );

  const requestOpenGraph = useCallback(
    (id: string) => {
      if (id === selectedId) return;
      if (isDirty) {
        dispatchPanel({ type: 'pendingGraphChanged', id });
        return;
      }
      void openGraph(id);
    },
    [isDirty, openGraph, selectedId]
  );

  const createGraph = async () => {
    setBusy('create');
    try {
      // Start every graph with its trigger node placed on the grid.
      const triggerEntry = catalog.find((entry) => entry.category === 'trigger');
      const triggerNodeType = triggerEntry?.type;
      const body: Record<string, unknown> = {
        name: `New workflow ${new Date().toLocaleTimeString()}`,
        nodes: triggerNodeType
          ? [
              {
                id: 'trigger',
                type: triggerNodeType,
                config: {},
                position: { x: 60, y: 120 },
              },
            ]
          : [],
        edges: [],
      };
      const res = await fetchWithCsrf('/api/admin/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create workflow');
      await loadList();
      await openGraph(data.graph.id);
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Failed to create workflow' });
    } finally {
      setBusy(null);
    }
  };

  const createFromTemplate = async (templateId: string) => {
    const template = WORKFLOW_TEMPLATES.find((entry) => entry.id === templateId);
    if (!template) return;
    setBusy('create');
    try {
      const res = await fetchWithCsrf('/api/admin/workflows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: template.name,
          nodes: template.nodes.map((node) => ({ ...node, config: { ...node.config } })),
          edges: template.edges,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create workflow from template');
      await loadList();
      await openGraph(data.graph.id);
      setMessage({
        ok: true,
        text: `Started from "${template.name}" as a draft. Review each node, then publish.`,
      });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Failed to create workflow from template' });
    } finally {
      setBusy(null);
    }
  };

  const persist = async (action: 'save' | 'publish' | 'disable' | 'enable') => {
    if (!selectedId) return;
    const currentActive = graphs.find((graph) => graph.name === meta.name && graph.enabled);
    if (action === 'enable') {
      const decision = await requestActionImpact({ title: 'Enable workflow version', description: currentActive ? `Replace active v${currentActive.version} with v${meta.version} for new runs. In-progress runs remain pinned.` : `Enable v${meta.version} for new runs.`, items: [{ label: 'New runs', value: `Use v${meta.version}` }, { label: 'In-progress runs', value: 'Remain pinned to their original version' }], confirmLabel: 'Enable version', evidence: 'Version activation is audited and historical graph versions remain immutable.' });
      if (!decision.confirmed) return;
    }
    setBusy(action);
    setMessage(null);
    try {
      const draft = toDraft(nodes, edges);
      const res = await fetchWithCsrf(`/api/admin/workflows/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draft,
          description: meta.description,
          action,
          expectedUpdatedAt: meta.updatedAt,
          expectedActiveGraphId: currentActive?.id ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Failed to ${action}`);
      const successCopy: Record<typeof action, string> = {
        save: 'Draft saved.',
        publish: 'Version published. Enable new runs when you are ready.',
        disable: 'New runs disabled. Runs already in progress will finish.',
        enable: 'New runs enabled for this version.',
      };
      setMessage({ ok: true, text: successCopy[action] });
      await loadList();
      if (action === 'save') {
        dispatchPanel({ type: 'draftSaved', savedSignature: currentSignature, updatedAt: data.graph.updatedAt });
      } else {
        await openGraph(selectedId);
      }
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : `Failed to ${action}` });
    } finally {
      setBusy(null);
    }
  };

  const createDraftFromVersion = async () => {
    if (!selectedId) return;
    setBusy('create_draft');
    setMessage(null);
    try {
      const res = await fetchWithCsrf(`/api/admin/workflows/${selectedId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create_draft' }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create draft');
      await loadList();
      await openGraph(data.graph.id);
      setMessage({
        ok: true,
        text: data.existingDraft
          ? `Opened the existing v${data.graph.version} draft.`
          : `Created v${data.graph.version} as an isolated draft.`,
      });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Failed to create draft' });
    } finally {
      setBusy(null);
    }
  };

  const cloneSeededExample = async () => {
    if (!selectedId) return;
    setBusy('clone_example');
    setMessage(null);
    try {
      const response = await fetchWithCsrf(`/api/admin/workflows/${selectedId}/clone`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to clone workflow example');
      await loadList();
      await openGraph(data.graph.id);
      setMessage({
        ok: true,
        text: `Created disabled draft v${data.graph.version}. Review executable destinations before publishing.`,
      });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Failed to clone workflow example' });
    } finally {
      setBusy(null);
    }
  };

  const removeGraph = async () => {
    if (!selectedId) return;
    setBusy('delete');
    try {
      const res = await fetchWithCsrf(`/api/admin/workflows/${selectedId}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete');
      setNodes([]);
      setEdges([]);
      dispatchPanel({ type: 'deleted' });
      await loadList();
      setMessage({ ok: true, text: data.deleted ? 'Deleted.' : 'Retired (history preserved).' });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Failed to delete' });
    } finally {
      setBusy(null);
    }
  };

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((current) =>
        addEdge<RFEdge>(
          {
            ...connection,
            id: `e-${connection.source}-${connection.sourceHandle ?? 'out'}-${connection.target}`,
            markerEnd: { type: MarkerType.ArrowClosed },
          },
          current
        )
      );
    },
    [setEdges]
  );

  const addPaletteNode = (entry: CatalogEntry) => {
    const id = `${entry.category}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const newNode: RFNode = {
      id,
      type: 'flow',
      position: { x: 320 + Math.random() * 160, y: 80 + Math.random() * 180 },
      data: { nodeType: entry.type, entry, config: entry.type === 'source_monitor_endpoints' ? { checks: [] } : {} },
    };
    if (entry.category === 'source' || entry.category === 'trigger') {
      const rootIds = new Set<string>();
      for (const node of nodes) {
        const category = catalogByType.get(String(node.data.nodeType))?.category;
        if (category === 'source' || category === 'trigger') rootIds.add(node.id);
      }
      setNodes((current) => [...current.filter((node) => !rootIds.has(node.id)), newNode]);
      setEdges((current) => current.filter((edge) => !rootIds.has(edge.source) && !rootIds.has(edge.target)));
    } else {
      setNodes((current) => [...current, newNode]);
    }
    dispatchPanel({ type: 'selectedNodeChanged', id });
  };

  const updateSelectedConfig = (field: string, value: unknown) => {
    if (!selectedNodeId) return;
    setNodes((current) =>
      current.map((node) =>
        node.id === selectedNodeId
          ? {
              ...node,
              data: {
                ...node.data,
                config: { ...(node.data.config as Record<string, unknown>), [field]: value },
              },
            }
          : node
      )
    );
  };

  const plainSummary = useMemo(
    () =>
      describeWorkflowSummary(
        nodes.map((node) => ({
          id: node.id,
          type: String(node.data.nodeType),
          config: (node.data.config ?? {}) as Record<string, unknown>,
        })),
        edges.map((edge) => ({
          source: edge.source,
          sourceHandle: edge.sourceHandle ?? null,
          target: edge.target,
        }))
      ),
    [nodes, edges]
  );

  return {
    graphs, catalog, loading, busy, message, panelState, selectedId, runs, savedSignature,
    pendingGraphId, deleteOpen, meta, selectedNodeId, nodes, edges, onNodesChange, onEdgesChange,
    selectedNode, selectedEntry, isDirty, triggerContextFields, conditionGroupsActive, groupOptions,
    monitorCredentials, credentialDraft, credentialBusy, recovery, requestOpenGraph, createGraph,
    createFromTemplate, reconcileWorkflowOperation, setCredentialDraft, createMonitorCredential,
    persist, createDraftFromVersion, cloneSeededExample, removeGraph, onConnect, addPaletteNode,
    updateSelectedConfig, plainSummary, dispatchPanel, openGraph,
  };
}

type WorkflowPanelModel = ReturnType<typeof useWorkflowsPanelView>;

function visibleWorkflowConfigFields(entry: CatalogEntry, conditionGroupsActive: boolean): NodeConfigField[] {
  const fields: NodeConfigField[] = [];
  for (const field of entry.configSchema) {
    if (!conditionGroupsActive || (field.name !== 'field' && field.name !== 'equals')) fields.push(field);
  }
  return fields;
}

function WorkflowNodeInspector({
  conditionGroupsActive,
  groupOptions,
  monitorCredentials,
  selectedEntry,
  selectedNode,
  triggerContextFields,
  updateSelectedConfig,
}: {
  conditionGroupsActive: boolean;
  groupOptions: ComboboxOption[];
  monitorCredentials: MonitorCredentialOption[];
  selectedEntry: CatalogEntry | undefined;
  selectedNode: RFNode | undefined;
  triggerContextFields: Array<{ key: string; label: string }>;
  updateSelectedConfig: (field: string, value: unknown) => void;
}) {
  return (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Inspector</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    {!selectedNode && (
                      <p className="text-sm text-muted-foreground">Select a node on the canvas to configure it.</p>
                    )}
                    {selectedNode && selectedEntry && (
                      <>
                        <p className="text-sm font-medium flex items-center gap-2">
                          {nodeIcon(String(selectedNode.data.nodeType))}
                          {selectedEntry.label}
                        </p>
                        {selectedEntry.description && (
                          <p className="text-xs text-muted-foreground">{selectedEntry.description}</p>
                        )}
                        {selectedEntry.type === 'logic_condition' && (
                          <ConditionGroupsEditor
                            groups={
                              conditionGroupsActive
                                ? ((selectedNode.data.config as Record<string, unknown>).groups as ConditionGroupDraft[])
                                : []
                            }
                            contextFields={triggerContextFields}
                            onChange={(next) =>
                              updateSelectedConfig('groups', next.length > 0 ? next : undefined)
                            }
                          />
                        )}
                        {visibleWorkflowConfigFields(selectedEntry, conditionGroupsActive).map((rawField) => {
                          const config = (selectedNode.data.config ?? {}) as Record<string, unknown>;
                          const field = resolveEffectiveField(selectedEntry, config, rawField);
                          const value = config[field.name];
                          const fieldId = `workflow-node-${selectedNode.id}-${field.name}`;
                          if (field.kind === 'monitor-checks') {
                            return (
                              <MonitorChecksEditor
                                key={field.name}
                                checks={Array.isArray(value) ? value as MonitorCheckDraft[] : []}
                                credentials={monitorCredentials}
                                onChange={(next) => updateSelectedConfig(field.name, next)}
                              />
                            );
                          }
                          if (field.kind === 'group-dns') {
                            const configured = Array.isArray(value)
                              ? value.filter((entry): entry is string => typeof entry === 'string')
                              : typeof config.groupDn === 'string' && config.groupDn
                                ? [config.groupDn]
                                : [];
                            const selectedValues = configured.slice(0, 10);
                            const selectedValueSet = new Set(selectedValues);
                            const addGroup = (groupDn: string) => {
                              if (!groupDn || selectedValues.some((entry) => entry.toLowerCase() === groupDn.toLowerCase()) || selectedValues.length >= 10) return;
                              updateSelectedConfig(field.name, [...selectedValues, groupDn]);
                            };
                            return (
                              <div key={field.name} className="space-y-2">
                                <Label htmlFor={fieldId} className="text-xs">{field.label}{field.required ? ' *' : ''}</Label>
                                <div className="min-h-9 border bg-background p-1.5">
                                  {selectedValues.length === 0 ? <p className="px-1 text-xs text-muted-foreground">No groups selected.</p> : (
                                    <div className="flex flex-wrap gap-1.5">
                                      {selectedValues.map((groupDn) => {
                                        const option = groupOptions.find((candidate) => candidate.value === groupDn);
                                        return <span key={groupDn} className="inline-flex max-w-full items-center gap-1 border-l-2 border-violet-500 bg-violet-500/8 px-2 py-1 text-xs"><span className="truncate" title={groupDn}>{groupDn === '{{joinGroupDn}}' ? 'Requested group' : option?.label ?? groupDn}</span><button type="button" onClick={() => updateSelectedConfig(field.name, selectedValues.filter((entry) => entry !== groupDn))} aria-label={`Remove ${option?.label ?? groupDn}`}><X className="h-3 w-3" /></button></span>;
                                      })}
                                    </div>
                                  )}
                                </div>
                                <Combobox
                                  options={groupOptions.filter((option) => !selectedValueSet.has(option.value))}
                                  id={fieldId}
                                  aria-label={field.label}
                                  value=""
                                  onValueChange={addGroup}
                                  placeholder={selectedValues.length >= 10 ? '10-group limit reached' : 'Add an approved group…'}
                                  searchPlaceholder="Search groups…"
                                  emptyMessage="No additional groups available."
                                />
                                <button type="button" disabled={selectedValueSet.has('{{joinGroupDn}}') || selectedValues.length >= 10} onClick={() => addGroup('{{joinGroupDn}}')} className="text-xs text-primary underline-offset-2 hover:underline disabled:opacity-50">+ Include the requester&apos;s requested group</button>
                                {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
                              </div>
                            );
                          }
                          if (field.kind === 'select' && field.options) {
                            return (
                              <div key={field.name} className="space-y-1">
                                <Label htmlFor={fieldId} className="text-xs">{field.label}{field.required ? ' *' : ''}</Label>
                                <select
                                  id={fieldId}
                                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                                  value={String(value ?? '')}
                                  onChange={(event) => updateSelectedConfig(field.name, event.target.value)}
                                >
                                  <option value="">Choose…</option>
                                  {field.options.map((option) => (
                                    <option key={option.value} value={option.value}>{option.label}</option>
                                  ))}
                                </select>
                                {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
                              </div>
                            );
                          }
                          if (field.kind === 'group-dn') {
                            const isJoinToken = String(value ?? '') === '{{joinGroupDn}}';
                            return (
                              <div key={field.name} className="space-y-1">
                                <Label htmlFor={fieldId} className="text-xs">{field.label}{field.required ? ' *' : ''}</Label>
                                <Combobox
                                  id={fieldId}
                                  aria-label={field.label}
                                  options={groupOptions}
                                  value={isJoinToken ? '' : String(value ?? '')}
                                  onValueChange={(next) => updateSelectedConfig(field.name, next)}
                                  placeholder={groupOptions.length > 0 ? 'Search groups…' : 'No groups loaded - type a DN below'}
                                  searchPlaceholder="Search by group or container…"
                                  emptyMessage="No groups available."
                                  renderSelected={(option) =>
                                    option ? (
                                      <span className="flex min-w-0 flex-col items-start leading-tight">
                                        <span className="truncate font-medium">{option.label}</span>
                                        {option.meta && (
                                          <span className="truncate text-xs font-normal text-muted-foreground">{option.meta}</span>
                                        )}
                                      </span>
                                    ) : null
                                  }
                                />
                                {String(selectedNode.data.nodeType) === 'action_enqueue_group_add' && (
                                  <button
                                    type="button"
                                    onClick={() => updateSelectedConfig(field.name, '{{joinGroupDn}}')}
                                    className="text-xs text-primary underline-offset-2 hover:underline"
                                  >
                                    Use the requester&apos;s requested group ({"{{joinGroupDn}}"})
                                  </button>
                                )}
                                {!isJoinToken && String(value ?? '') && !groupOptions.some((option) => option.value === String(value)) && (
                                  <Input
                                    id={`${fieldId}-manual`}
                                    aria-label={field.label}
                                    value={String(value)}
                                    onChange={(event) => updateSelectedConfig(field.name, event.target.value)}
                                    placeholder="CN=Group,OU=…,DC=…"
                                    className="h-8 font-mono text-xs"
                                  />
                                )}
                                {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
                              </div>
                            );
                          }
                          if (field.kind === 'boolean') {
                            return (
                              <div key={field.name} className="space-y-1">
                                <Label htmlFor={fieldId} className="text-xs">{field.label}{field.required ? ' *' : ''}</Label>
                                <select
                                  id={fieldId}
                                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
                                  value={String(value ?? '')}
                                  onChange={(event) => updateSelectedConfig(field.name, event.target.value)}
                                >
                                  <option value="">Choose…</option>
                                  <option value="true">true</option>
                                  <option value="false">false</option>
                                </select>
                                {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
                              </div>
                            );
                          }
                          if (field.kind === 'text') {
                            return (
                              <div key={field.name} className="space-y-1">
                                <Label htmlFor={fieldId} className="text-xs">{field.label}{field.required ? ' *' : ''}</Label>
                                <textarea
                                  id={fieldId}
                                  rows={3}
                                  className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm"
                                  placeholder={field.placeholder}
                                  value={String(value ?? '')}
                                  onChange={(event) => updateSelectedConfig(field.name, event.target.value)}
                                />
                                {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
                              </div>
                            );
                          }
                          return (
                            <div key={field.name} className="space-y-1">
                              <Label htmlFor={fieldId} className="text-xs">{field.label}{field.required ? ' *' : ''}</Label>
                              <Input
                                id={fieldId}
                                type={field.kind === 'number' ? 'number' : 'text'}
                                placeholder={field.placeholder}
                                value={String(value ?? '')}
                                onChange={(event) => updateSelectedConfig(field.name, event.target.value)}
                              />
                              {field.help && <p className="text-xs text-muted-foreground">{field.help}</p>}
                            </div>
                          );
                        })}
                      </>
                    )}
                  </CardContent>
                </Card>
  );
}
type WorkflowPersistAction = 'save' | 'publish' | 'disable' | 'enable';

function DraftWorkflowActions({ busy, isDirty, onPersist }: { busy: string | null; isDirty: boolean; onPersist: (action: WorkflowPersistAction) => void }) {
  return <><Button size="sm" variant="outline" disabled={!!busy || !isDirty} onClick={() => onPersist('save')}>{busy === 'save' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save draft</Button><Button size="sm" disabled={!!busy || isDirty} onClick={() => onPersist('publish')}>{busy === 'publish' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Rocket className="mr-2 h-4 w-4" />}Publish version</Button></>;
}

function PublishedWorkflowActions({ busy, enabled, onCreateDraft, onPersist }: { busy: string | null; enabled: boolean; onCreateDraft: () => void; onPersist: (action: WorkflowPersistAction) => void }) {
  return <><Button size="sm" variant="outline" disabled={!!busy} onClick={onCreateDraft}>{busy === 'create_draft' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Pencil className="mr-2 h-4 w-4" />}Edit as new draft</Button>{enabled ? <Button size="sm" variant="outline" disabled={!!busy} onClick={() => onPersist('disable')}><Ban className="mr-2 h-4 w-4" />Disable new runs</Button> : <Button size="sm" disabled={!!busy} onClick={() => onPersist('enable')}><Play className="mr-2 h-4 w-4" />Enable new runs</Button>}</>;
}

function WorkflowHeaderActions({ busy, isDirty, meta, selectedIsSeededExample, onCloneSeededExample, onCreateDraft, onDeleteDraft, onPersist }: { busy: string | null; isDirty: boolean; meta: WorkflowPanelState['meta']; selectedIsSeededExample: boolean; onCloneSeededExample: () => void; onCreateDraft: () => void; onDeleteDraft: () => void; onPersist: (action: WorkflowPersistAction) => void }) {
  if (selectedIsSeededExample) return <Button size="sm" disabled={!!busy} onClick={onCloneSeededExample}>{busy === 'clone_example' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Copy className="mr-2 h-4 w-4" />}Clone as disabled draft</Button>;
  if (meta.status === 'draft') return <><DraftWorkflowActions busy={busy} isDirty={isDirty} onPersist={onPersist} /><Button size="sm" variant="destructive" disabled={!!busy} onClick={onDeleteDraft} aria-label="Delete draft"><Trash2 className="h-4 w-4" /></Button></>;
  return <PublishedWorkflowActions busy={busy} enabled={meta.enabled} onCreateDraft={onCreateDraft} onPersist={onPersist} />;
}

function WorkflowEditorHeader({
  busy,
  isDirty,
  meta,
  plainSummary,
  selectedIsSeededExample,
  onCloneSeededExample,
  onCreateDraft,
  onDeleteDraft,
  onPersist,
}: {
  busy: string | null;
  isDirty: boolean;
  meta: WorkflowPanelState['meta'];
  plainSummary: string;
  selectedIsSeededExample: boolean;
  onCloneSeededExample: () => void;
  onCreateDraft: () => void;
  onDeleteDraft: () => void;
  onPersist: (action: WorkflowPersistAction) => void;
}) {
  return <Card><CardContent className="flex flex-wrap items-end gap-3 pt-4">
    <div className="min-w-[220px] flex-1 space-y-1"><Label htmlFor="workflow-name" className="text-xs text-muted-foreground">Name</Label><Input id="workflow-name" value={meta.name} disabled className="h-9" /></div>
    <Badge variant={meta.enabled ? 'default' : 'secondary'}>{meta.enabled ? 'enabled' : meta.status}</Badge><Badge variant="outline">v{meta.version}</Badge>
    {selectedIsSeededExample && <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">Example · read only</Badge>}
    {isDirty && <Badge variant="outline" className="border-amber-500/50 text-amber-700 dark:text-amber-300">Unsaved changes</Badge>}
    <div className="ml-auto flex gap-2"><WorkflowHeaderActions busy={busy} isDirty={isDirty} meta={meta} selectedIsSeededExample={selectedIsSeededExample} onCloneSeededExample={onCloneSeededExample} onCreateDraft={onCreateDraft} onDeleteDraft={onDeleteDraft} onPersist={onPersist} /></div>
    {plainSummary && <p className="flex w-full items-start gap-1.5 rounded-md bg-muted/40 px-2.5 py-1.5 text-xs leading-relaxed text-muted-foreground"><Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /><span>{plainSummary}</span></p>}
    {selectedIsSeededExample && <p className="w-full rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-1.5 text-xs text-muted-foreground">Seeded examples are immutable and cannot be published or enabled. Clone one to create an operator-owned disabled draft; the server checks destinations and runtime tokens again when you publish or enable it.</p>}
  </CardContent></Card>;
}

function WorkflowPanelView({ model }: { model: WorkflowPanelModel }) {
  const {
    graphs, catalog, loading, busy, message, selectedId, runs, pendingGraphId, deleteOpen, meta,
    nodes, edges, onNodesChange, onEdgesChange, selectedNode, selectedEntry, isDirty,
    triggerContextFields, conditionGroupsActive, groupOptions, monitorCredentials, credentialDraft,
    credentialBusy, recovery, requestOpenGraph, createGraph, createFromTemplate,
    reconcileWorkflowOperation, setCredentialDraft, createMonitorCredential, persist,
    createDraftFromVersion, cloneSeededExample, removeGraph, onConnect, addPaletteNode,
    updateSelectedConfig, plainSummary, dispatchPanel, openGraph,
  } = model;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  const groupedCatalog: Record<string, CatalogEntry[]> = { source: [], trigger: [], logic: [], action: [] };
  for (const entry of catalog) groupedCatalog[entry.category]?.push(entry);
  const selectedIsSeededExample = selectedId !== null && isSeededWorkflowExample(selectedId);

  return (
    <div className="space-y-4">
      {message && (
        <Alert variant={message.ok ? 'default' : 'destructive'}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
        <WorkflowPanelSidebar
          busy={busy}
          catalog={catalog}
          credentialForm={<MonitorCredentialForm credentialDraft={credentialDraft} credentialBusy={credentialBusy} onChange={setCredentialDraft} onCreate={createMonitorCredential} />}
          graphs={graphs}
          monitorCredentials={monitorCredentials}
          recovery={recovery}
          selectedId={selectedId}
          selectedIsSeededExample={selectedIsSeededExample}
          onAddPaletteNode={addPaletteNode}
          onCreateBlank={createGraph}
          onCreateFromTemplate={createFromTemplate}
          onOpenGraph={requestOpenGraph}
          onReconcile={reconcileWorkflowOperation}
          paletteIcon={paletteIcon}
        />

        {/* Canvas + inspector */}
        <div className="space-y-4">
          {selectedId ? (
            <>
              <WorkflowEditorHeader
                busy={busy}
                isDirty={isDirty}
                meta={meta}
                plainSummary={plainSummary}
                selectedIsSeededExample={selectedIsSeededExample}
                onCloneSeededExample={cloneSeededExample}
                onCreateDraft={createDraftFromVersion}
                onDeleteDraft={() => dispatchPanel({ type: 'deleteDialogChanged', open: true })}
                onPersist={persist}
              />
              <div className={`grid gap-4 ${selectedEntry?.type === 'source_monitor_endpoints' ? 'xl:grid-cols-[minmax(0,1fr)_460px]' : 'xl:grid-cols-[minmax(0,1fr)_340px]'}`}>
                <div className="h-[520px] rounded-lg border bg-card dark:bg-card overflow-hidden">
                  <ReactFlow
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={onConnect}
                    onNodeClick={(_, node) => dispatchPanel({ type: 'selectedNodeChanged', id: node.id })}
                    onPaneClick={() => dispatchPanel({ type: 'selectedNodeChanged', id: null })}
                    fitView
                    nodesDraggable={!selectedIsSeededExample}
                    nodesConnectable={!selectedIsSeededExample}
                    proOptions={{ hideAttribution: true }}
                  >
                    <Background gap={18} />
                    <Controls showInteractive={false} />
                    <MiniMap pannable zoomable />
                  </ReactFlow>
                </div>

                <WorkflowNodeInspector
                  conditionGroupsActive={conditionGroupsActive}
                  groupOptions={groupOptions}
                  monitorCredentials={monitorCredentials}
                  selectedEntry={selectedEntry}
                  selectedNode={selectedNode}
                  triggerContextFields={triggerContextFields}
                  updateSelectedConfig={updateSelectedConfig}
                />
              </div>

              <WorkflowRunHistory runs={runs} />
            </>
          ) : (
            <Card>
              <CardContent className="flex h-64 items-center justify-center text-sm text-muted-foreground">
                Select or create a workflow to design it on the grid.
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <WorkflowPanelDialogs
        pendingGraphId={pendingGraphId}
        deleteOpen={deleteOpen}
        version={meta.version}
        onPendingGraphChange={(id) => dispatchPanel({ type: 'pendingGraphChanged', id })}
        onDiscardAndSwitch={(nextId) => {
          dispatchPanel({ type: 'pendingGraphChanged', id: null });
          void openGraph(nextId);
        }}
        onDeleteDialogChange={(open) => dispatchPanel({ type: 'deleteDialogChanged', open })}
        onDelete={() => void removeGraph()}
      />
    </div>
  );
}

export default function WorkflowsPanel() {
  return <WorkflowPanelView model={useWorkflowsPanelView()} />;
}
