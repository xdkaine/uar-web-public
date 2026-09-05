'use client';

import { useId, type ReactNode } from 'react';
import { CheckCircle2, CircleHelp, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { ConfigEntry } from './config-types';
import type { TestOutcome } from './directory-panel-shared';

function SourceBadge({ entry }: { entry: ConfigEntry }) {
  const storedHere = entry.source === 'database';
  const statusLabel = entry.secret
    ? entry.configured
      ? 'configured'
      : 'not set'
    : entry.source === 'database'
      ? 'saved here'
      : entry.source === 'environment'
        ? 'from environment'
        : 'default';
  return (
    <Badge variant={storedHere ? 'default' : 'secondary'} className="text-xs">
      {statusLabel}
    </Badge>
  );
}

function HelpTooltip({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  return (
    <span className="group/field-help relative inline-flex shrink-0 align-middle">
      <button
        type="button"
        aria-label={`About ${label}`}
        aria-describedby={id}
        className="inline-flex h-5 w-5 cursor-help items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <CircleHelp className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-1/2 z-50 mb-2 w-72 -translate-x-1/2 rounded-md border border-border bg-popover px-3 py-2 text-left text-xs font-normal leading-relaxed text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover/field-help:visible group-hover/field-help:opacity-100 group-focus-within/field-help:visible group-focus-within/field-help:opacity-100"
      >
        {children}
      </span>
    </span>
  );
}

export function FieldShell({
  id,
  label,
  icon,
  entry,
  dirty,
  help,
  children,
}: {
  id: string;
  label: string;
  icon?: ReactNode;
  entry: ConfigEntry;
  dirty: boolean;
  /** Plain-language explanation available from the field's help tooltip. */
  help?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5" data-field-id={id}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1.5 text-sm font-medium">
          {icon}
          {label}
          {help && <HelpTooltip label={label}>{help}</HelpTooltip>}
        </span>
        <SourceBadge entry={entry} />
        {dirty && <Badge variant="outline">modified</Badge>}
      </div>
      {children}
    </div>
  );
}

export function OutcomeLine({ outcome }: { outcome: TestOutcome }) {
  return (
    <div
      className={`flex items-start gap-1.5 rounded border px-2 py-1.5 text-xs ${
        outcome.ok
          ? 'border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100'
          : 'border-destructive/30 bg-destructive/10 text-destructive'
      }`}
    >
      {outcome.ok ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      ) : (
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      )}
      <span className="break-all">{outcome.text}</span>
    </div>
  );
}
