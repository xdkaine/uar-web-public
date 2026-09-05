'use client';

import type { ComponentType, ReactNode } from 'react';
import { KeyRound, Loader2, Plus, Sparkles } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { WORKFLOW_TEMPLATES } from '@/lib/flow/templates';
import { isSeededWorkflowExample } from '@/lib/flow/publication-guard';
import type { CatalogEntry, MonitorCredentialOption, StoredGraph } from './workflowPanelTypes';

type Recovery = {
  timers: Array<{ id: string; nodeId: string; attempts: number; lastError: string | null; run: { graph: { name: string; version: number } } }>;
  emailAttempts: Array<{ id: string; nodeId: string; kind: string; attempts: number; lastError: string | null }>;
  providerLogouts: Array<{ id: string; username: string; reason: string; attempts: number; lastError: string | null }>;
};

interface WorkflowPanelSidebarProps {
  busy: string | null;
  catalog: CatalogEntry[];
  credentialForm: ReactNode;
  graphs: StoredGraph[];
  monitorCredentials: MonitorCredentialOption[];
  recovery: Recovery;
  selectedId: string | null;
  selectedIsSeededExample: boolean;
  onAddPaletteNode: (entry: CatalogEntry) => void;
  onCreateBlank: () => void;
  onCreateFromTemplate: (templateId: string) => void;
  onOpenGraph: (id: string) => void;
  onReconcile: (kind: 'timer' | 'action_attempt' | 'email_attempt' | 'provider_logout', id: string, resolution: 'not_executed' | 'not_delivered' | 'retry_authorized') => void;
  paletteIcon: (type: string) => ComponentType<{ className?: string }>;
}

function RecoveryQueue({ recovery, busy, onReconcile }: Pick<WorkflowPanelSidebarProps, 'recovery' | 'busy' | 'onReconcile'>) {
  if (recovery.timers.length === 0 && recovery.emailAttempts.length === 0 && recovery.providerLogouts.length === 0) return null;
  return <Card><CardHeader className="pb-2"><CardTitle className="text-base">Recovery queue</CardTitle></CardHeader><CardContent className="space-y-2 pt-0 text-xs">
    {recovery.timers.map((timer) => <div key={timer.id} className="rounded border p-2"><p className="font-medium">{timer.run.graph.name} v{timer.run.graph.version}</p><p className="text-muted-foreground">Timer node {timer.nodeId} · {timer.attempts} attempt(s)</p><p className="mt-1 line-clamp-2 text-muted-foreground">{timer.lastError}</p><Button size="sm" variant="outline" className="mt-2 w-full" disabled={busy === `recovery:${timer.id}`} onClick={() => onReconcile('timer', timer.id, 'not_executed')}>Re-arm with evidence</Button></div>)}
    {recovery.emailAttempts.map((attempt) => <div key={attempt.id} className="rounded border p-2"><p className="font-medium">{attempt.kind === 'email' ? 'Unknown email outcome' : 'Unknown workflow action outcome'}</p><p className="text-muted-foreground">Node {attempt.nodeId} · {attempt.attempts} attempt(s)</p><p className="mt-1 line-clamp-2 text-muted-foreground">{attempt.lastError}</p><Button size="sm" variant="outline" className="mt-2 w-full" disabled={busy === `recovery:${attempt.id}`} onClick={() => onReconcile(attempt.kind === 'email' ? 'email_attempt' : 'action_attempt', attempt.id, attempt.kind === 'email' ? 'not_delivered' : 'not_executed')}>Authorize retry</Button></div>)}
    {recovery.providerLogouts.map((task) => <div key={task.id} className="rounded border p-2"><p className="font-medium">Provider logout for {task.username}</p><p className="text-muted-foreground">{task.reason} · {task.attempts} attempt(s)</p><p className="mt-1 line-clamp-2 text-muted-foreground">{task.lastError}</p><Button size="sm" variant="outline" className="mt-2 w-full" disabled={busy === `recovery:${task.id}`} onClick={() => onReconcile('provider_logout', task.id, 'retry_authorized')}>Retry logout with evidence</Button></div>)}
  </CardContent></Card>;
}

export function WorkflowPanelSidebar(props: WorkflowPanelSidebarProps) {
  const groupedCatalog: Record<string, CatalogEntry[]> = { source: [], trigger: [], logic: [], action: [] };
  for (const entry of props.catalog) groupedCatalog[entry.category]?.push(entry);
  return <aside className="space-y-4">
    <Card><CardHeader className="pb-2"><CardTitle className="flex items-center justify-between text-base">Workflows<DropdownMenu><DropdownMenuTrigger asChild><Button size="sm" disabled={props.busy === 'create'}>{props.busy === 'create' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}New</Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-64"><DropdownMenuItem onClick={props.onCreateBlank}><Plus className="h-4 w-4" /> Blank workflow</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuLabel className="text-xs text-muted-foreground">Start from a template</DropdownMenuLabel>{WORKFLOW_TEMPLATES.map((template) => <DropdownMenuItem key={template.id} onClick={() => props.onCreateFromTemplate(template.id)} className="gap-2"><Sparkles className="h-4 w-4 shrink-0 text-primary" /><span className="flex min-w-0 flex-col"><span className="font-medium">{template.name}</span><span className="truncate text-xs text-muted-foreground">{template.description}</span></span></DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></CardTitle></CardHeader><CardContent className="space-y-1.5 pt-0">{props.graphs.length === 0 && <p className="text-sm text-muted-foreground">No workflows yet. Create one to start designing.</p>}{props.graphs.map((graph) => <button key={`${graph.id}-${graph.version}`} onClick={() => props.onOpenGraph(graph.id)} className={`w-full rounded border px-2.5 py-2 text-left transition-colors hover:bg-muted/40 ${props.selectedId === graph.id ? 'border-primary bg-muted/30' : ''}`}><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{graph.name}</span>{graph.enabled ? <Badge className="shrink-0">live</Badge> : <Badge variant="secondary" className="shrink-0">{graph.status}</Badge>}</span><span className="text-xs text-muted-foreground">v{graph.version}</span>{isSeededWorkflowExample(graph.id) && <span className="ml-1 text-xs font-medium text-amber-700 dark:text-amber-300">Example</span>}</button>)}</CardContent></Card>
    <RecoveryQueue recovery={props.recovery} busy={props.busy} onReconcile={props.onReconcile} />
    <Card><CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4" />Monitor credentials</CardTitle></CardHeader><CardContent className="space-y-3 pt-0"><div className="space-y-1">{props.monitorCredentials.map((credential) => <div key={credential.id} className="border-l-2 border-amber-500 pl-2 text-xs"><div className="flex items-center justify-between gap-2"><strong className="truncate">{credential.name}</strong><Badge variant={credential.enabled ? 'outline' : 'secondary'}>{credential.kind.replace('_', ' ')}</Badge></div><p className="truncate text-muted-foreground" title={credential.allowedHosts.join(', ')}>{credential.allowedHosts.join(', ')}</p></div>)}{props.monitorCredentials.length === 0 && <p className="text-xs text-muted-foreground">No credentials. Anonymous checks still work.</p>}</div>{props.credentialForm}<p className="text-[11px] text-muted-foreground">Secrets are encrypted, metadata-only on read, and usable only for exact allowed hosts.</p></CardContent></Card>
    <Card><CardHeader className="pb-2"><CardTitle className="text-base">Node palette</CardTitle></CardHeader><CardContent className="space-y-3 pt-0">{(['source', 'trigger', 'logic', 'action'] as const).map((category) => <div key={category}><p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{category === 'source' ? 'Operational sources' : `${category}s`}</p><div className="space-y-1">{groupedCatalog[category].map((entry) => { const Icon = props.paletteIcon(entry.type); return <button key={entry.type} onClick={() => props.selectedId && props.onAddPaletteNode(entry)} disabled={!props.selectedId || props.selectedIsSeededExample} title={entry.description} className="flex w-full items-center gap-2 rounded border px-2 py-1.5 text-left text-xs hover:bg-muted/40 disabled:opacity-50"><Icon className="h-3.5 w-3.5 shrink-0" />{entry.label}</button>; })}</div></div>)}</CardContent></Card>
  </aside>;
}
