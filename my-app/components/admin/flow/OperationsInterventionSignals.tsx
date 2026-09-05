'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ShieldAlert, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { OperationalSignal } from './OperationsDashboardTypes';
import { ClientLocalDate } from '@/components/admin/ClientLocalDate';

interface Props { activeSignals: OperationalSignal[]; accessRequestLinksAvailable: boolean }

export function OperationsInterventionSignals({ activeSignals, accessRequestLinksAvailable }: Props) {
  return (
    <Card id="intervention-signals" className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldAlert className="h-4 w-4 text-primary" /> Intervention signals
          <Badge variant="secondary">{activeSignals.length}</Badge>
        </CardTitle>
        <CardDescription>
          Curated scheduler and access-request conditions that currently need review. Workflow notifications are configured separately.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        {activeSignals.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active structured detector episodes.</p>
        ) : (
          <div className="divide-y rounded-lg border">
            {activeSignals.map((signal) => {
              const href = signal.subjectType === 'scheduled_job'
                ? `/admin/operations?route=${encodeURIComponent(signal.subjectId)}`
                : accessRequestLinksAvailable
                  ? `/admin/requests/${encodeURIComponent(signal.subjectId)}`
                  : null;
              const content = (
                <>
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                    <Badge variant={signal.severity === 'critical' ? 'destructive' : 'secondary'}>{signal.severity}</Badge>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{signal.summary}</p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                        {signal.detectorKey} · {signal.reasonCode}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 pl-0 text-xs text-muted-foreground sm:pl-3">
                    <span>{signal.occurrenceCount} observation{signal.occurrenceCount === 1 ? '' : 's'}</span>
                    <span><ClientLocalDate value={signal.lastSeenAt} /></span>
                    {href ? <ChevronRight className="h-4 w-4" /> : null}
                  </div>
                </>
              );
              const className = "flex flex-col gap-2 px-4 py-3 first:rounded-t-lg last:rounded-b-lg sm:flex-row sm:items-center";
              return href ? (
                <a
                  key={signal.id}
                  href={href}
                  className={cn(className, 'transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring')}
                >
                  {content}
                </a>
              ) : <div key={signal.id} className={className}>{content}</div>;
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
