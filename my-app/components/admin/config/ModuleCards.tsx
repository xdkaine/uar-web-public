'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { ClientLocalDate } from '../ClientLocalDate';
import {
  ChevronDown,
  ChevronRight,
  Clock,
  LayoutGrid,
  Workflow,
  Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ModuleWorkflowUsage, ModuleAutomationUsage, ModuleCronUsage } from '@/lib/modules/usage';

export interface ModuleInfo {
  moduleId: string;
  enabled: boolean;
  overridden: boolean;
  definition: {
    id: string;
    name: string;
    description: string;
    disableImpact: string[];
    dependsOn: string[];
    configKeys?: string[];
    adminTabs?: string[];
    triggerKeys?: string[];
    cronJobKeys?: string[];
  } | null;
}

export interface ModuleUsageInfo {
  moduleId: string;
  enabled: boolean;
  adminTabs: string[];
  workflows: ModuleWorkflowUsage[];
  automationRules: ModuleAutomationUsage[];
  cronJobs: ModuleCronUsage[];
}

const WORKFLOW_STATUS_BADGE: Record<string, { label: string; variant: 'default' | 'secondary' | 'outline' }> = {
  published: { label: 'published', variant: 'default' },
  draft: { label: 'draft', variant: 'secondary' },
};

const CRON_HEALTH_BADGE: Record<string, { label: string; variant: 'default' | 'destructive' | 'secondary' | 'outline'; className?: string }> = {
  healthy: {
    label: 'healthy',
    variant: 'default',
    className: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  },
  failing: { label: 'failing', variant: 'destructive' },
  stale: { label: 'overdue', variant: 'secondary' },
  unknown: { label: 'never run', variant: 'outline' },
};

function cronHealthFor(job: ModuleCronUsage): string {
  if (!job.lastRunAt) return 'unknown';
  return job.healthy ? 'healthy' : 'failing';
}

function LastRun({ value }: { value: string | null }) {
  if (!value) return <>never run</>;
  return <>last run <ClientLocalDate value={value} /></>;
}

function WorkflowUsage({ workflows }: Pick<ModuleUsageInfo, 'workflows'>) {
  if (workflows.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Workflows</p>
      <ul className="space-y-1.5">
        {workflows.map((workflow) => {
          const statusBadge = WORKFLOW_STATUS_BADGE[workflow.status] ?? {
            label: workflow.status,
            variant: 'outline' as const,
          };
          return (
            <li key={workflow.id} className="flex flex-wrap items-center gap-2">
              <span>{workflow.name}</span>
              <Badge variant={statusBadge.variant}>{statusBadge.label}</Badge>
              <Badge variant="outline" className="font-mono text-xs">{workflow.triggerKey}</Badge>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AutomationUsage({ automationRules }: Pick<ModuleUsageInfo, 'automationRules'>) {
  if (automationRules.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Automation Rules</p>
      <ul className="space-y-1.5">
        {automationRules.map((rule) => (
          <li key={rule.id} className="flex flex-wrap items-center gap-2">
            <span>{rule.name}</span>
            {rule.enabled ? (
              <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">active</Badge>
            ) : (
              <Badge variant="secondary">paused</Badge>
            )}
            <Badge variant="outline" className="font-mono text-xs">{rule.triggerKey}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CronUsage({ cronJobs }: Pick<ModuleUsageInfo, 'cronJobs'>) {
  if (cronJobs.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scheduled Jobs</p>
      <ul className="space-y-1.5">
        {cronJobs.map((job) => {
          const health = CRON_HEALTH_BADGE[cronHealthFor(job)] ?? CRON_HEALTH_BADGE.unknown;
          return (
            <li key={job.key} className="flex flex-wrap items-center gap-2">
              <span>{job.label}</span>
              <Badge variant="outline" className="text-xs">{job.cadence}</Badge>
              <Badge variant={health.variant} className={health.className}>{health.label}</Badge>
              <span className="text-xs text-muted-foreground"><LastRun value={job.lastRunAt} /></span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ModuleUsageDetails({ usage }: { usage: ModuleUsageInfo }) {
  return (
    <div className="mt-3 space-y-4 text-sm">
      <WorkflowUsage workflows={usage.workflows} />
      <AutomationUsage automationRules={usage.automationRules} />
      <CronUsage cronJobs={usage.cronJobs} />
    </div>
  );
}

function ModuleIdentity({ module }: { module: ModuleInfo }) {
  const definition = module.definition;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="font-medium">{definition?.name ?? module.moduleId}</span>
      <Badge variant="outline" className="font-mono text-xs">{module.moduleId}</Badge>
      {module.enabled ? (
        <Badge variant="outline" className="border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400">enabled</Badge>
      ) : (
        <Badge variant="destructive">disabled</Badge>
      )}
      {!module.overridden && <Badge variant="secondary">default</Badge>}
    </div>
  );
}

function powerLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function modulePowerDetails(module: ModuleInfo, usage?: ModuleUsageInfo) {
  const definition = module.definition;
  const adminTabCount = usage ? usage.adminTabs.length : (definition?.adminTabs?.length ?? 0);
  const workflowCount = usage?.workflows.length ?? 0;
  const ruleCount = usage?.automationRules.length ?? 0;
  const cronCount = usage?.cronJobs.length ?? 0;
  const items: Array<{ icon: LucideIcon; label: string }> = [
    ...(adminTabCount > 0 ? [{ icon: LayoutGrid, label: `${powerLabel(adminTabCount, 'admin tab', 'admin tabs')}` }] : []),
    { icon: Workflow, label: powerLabel(workflowCount, 'workflow') },
    { icon: Zap, label: powerLabel(ruleCount, 'rule') },
    ...(cronCount > 0 ? [{ icon: Clock, label: `${cronCount} cron ${cronCount === 1 ? 'job' : 'jobs'}` }] : []),
  ];
  return {
    hasAny: adminTabCount > 0 || workflowCount > 0 || ruleCount > 0 || cronCount > 0,
    items,
  };
}

function ModulePowers({ module, usage }: Pick<ModuleSummaryProps, 'module' | 'usage'>) {
  const { hasAny, items } = modulePowerDetails(module, usage);
  if (!hasAny) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1">
      <span className="text-xs font-medium text-muted-foreground">Powers:</span>
      {items.map(({ icon: Icon, label }) => (
        <Badge key={label} variant="outline" className="gap-1">
          <Icon className="h-3 w-3" />
          {label}
        </Badge>
      ))}
    </div>
  );
}

function ModuleMetadata({ definition }: { definition: ModuleInfo['definition'] }) {
  if (!definition) return null;
  return (
    <>
      {definition.dependsOn.length > 0 && <p className="text-xs text-muted-foreground">Depends on: {definition.dependsOn.join(', ')}</p>}
      {(definition.configKeys?.length ?? 0) > 0 && <p className="text-xs text-muted-foreground">Settings keys: <span className="font-mono">{definition.configKeys!.join(', ')}</span></p>}
    </>
  );
}

interface ModuleSummaryProps {
  module: ModuleInfo;
  usage?: ModuleUsageInfo;
  saving: boolean;
  onToggle: (moduleId: string, enabled: boolean) => void;
}

function ModuleSummary({ module, usage, saving, onToggle }: ModuleSummaryProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1 min-w-0">
        <ModuleIdentity module={module} />
        <p className="text-sm text-muted-foreground">{module.definition?.description}</p>
        <ModulePowers module={module} usage={usage} />
        <ModuleMetadata definition={module.definition} />
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Switch checked={module.enabled} disabled={saving} onCheckedChange={(checked) => onToggle(module.moduleId, checked)} />
      </div>
    </div>
  );
}

function ModuleImpact({ module }: { module: ModuleInfo }) {
  const definition = module.definition;
  if (!definition) return null;

  if (!module.enabled) {
    return (
      <Alert>
        <AlertDescription>
          <ul className="list-disc pl-4 space-y-1">
            {definition.disableImpact.map((impact) => <li key={impact} className="text-sm">{impact}</li>)}
          </ul>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <details className="text-sm text-muted-foreground">
      <summary className="cursor-pointer select-none">What happens when disabled?</summary>
      <ul className="list-disc pl-4 mt-2 space-y-1">
        {definition.disableImpact.map((impact) => <li key={impact}>{impact}</li>)}
      </ul>
    </details>
  );
}

function ModuleCurrentUsage({
  moduleId,
  usage,
  expanded,
  onToggleExpanded,
}: {
  moduleId: string;
  usage?: ModuleUsageInfo;
  expanded: boolean;
  onToggleExpanded: (moduleId: string) => void;
}) {
  const hasDetail = (usage?.workflows.length ?? 0) > 0
    || (usage?.automationRules.length ?? 0) > 0
    || (usage?.cronJobs.length ?? 0) > 0;
  if (!hasDetail) return null;

  return (
    <div className="border-t pt-2">
      <button type="button" onClick={() => onToggleExpanded(moduleId)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors" aria-expanded={expanded}>
        {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        What this module powers right now
      </button>
      {expanded && usage && <ModuleUsageDetails usage={usage} />}
    </div>
  );
}

function ModuleCard({
  module,
  usage,
  expanded,
  saving,
  onToggle,
  onToggleExpanded,
}: {
  module: ModuleInfo;
  usage?: ModuleUsageInfo;
  expanded: boolean;
  saving: boolean;
  onToggle: (moduleId: string, enabled: boolean) => void;
  onToggleExpanded: (moduleId: string) => void;
}) {
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <ModuleSummary module={module} usage={usage} saving={saving} onToggle={onToggle} />
      <ModuleImpact module={module} />
      <ModuleCurrentUsage moduleId={module.moduleId} usage={usage} expanded={expanded} onToggleExpanded={onToggleExpanded} />
    </div>
  );
}

export default function ModuleCards({
  modules,
  usage,
  savingModule,
  expandedModules,
  onToggle,
  onToggleExpanded,
}: {
  modules: ModuleInfo[];
  usage: Record<string, ModuleUsageInfo>;
  savingModule: string | null;
  expandedModules: Set<string>;
  onToggle: (moduleId: string, enabled: boolean) => void;
  onToggleExpanded: (moduleId: string) => void;
}) {
  if (modules.length === 0) return <p className="text-sm text-muted-foreground">No optional modules are registered.</p>;

  return modules.map((module) => (
    <ModuleCard
      key={module.moduleId}
      module={module}
      usage={usage[module.moduleId]}
      expanded={expandedModules.has(module.moduleId)}
      saving={savingModule === module.moduleId}
      onToggle={onToggle}
      onToggleExpanded={onToggleExpanded}
    />
  ));
}
