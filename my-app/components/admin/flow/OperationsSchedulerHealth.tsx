'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Activity, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { healthFor, HEALTH_BADGE, formatInterval, type RouteHealth } from './operationsHealth';
import type { CronRouteDescriptor } from './OperationsDashboardTypes';
import { ClientLocalDate } from '@/components/admin/ClientLocalDate';

interface Props { scheduledJobs: CronRouteDescriptor[]; healthByRoute: ReadonlyMap<string, RouteHealth>; loadJobDetails: (job: CronRouteDescriptor) => Promise<void> }

export function OperationsSchedulerHealth({ scheduledJobs, healthByRoute, loadJobDetails }: Props) {
  return (
    <Card id="scheduler-health" className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Activity className="h-4 w-4 text-primary" /> Scheduler health
        </CardTitle>
        <CardDescription>
          All {scheduledJobs.length} registered scheduled jobs. Staleness is judged against each
          job&apos;s expected cadence; jobs disabled via compose show as never-run until enabled.
          Refreshes each minute.
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-hidden rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="pl-4">Status</TableHead>
                <TableHead>Job</TableHead>
                <TableHead className="hidden lg:table-cell">Purpose</TableHead>
                <TableHead className="w-[90px]">Cadence</TableHead>
                <TableHead className="w-[150px]">Outcomes</TableHead>
                <TableHead className="w-[170px] pr-4 text-right">Last run</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {scheduledJobs.map((job) => {
                const entry = healthByRoute.get(job.route);
                const health = job.enabled === false
                  ? 'disabled'
                  : healthFor(entry, job.expectedIntervalSeconds);
                const badge = HEALTH_BADGE[health];
                return (
                  <TableRow
                    key={job.route}
                    className="cursor-pointer focus-within:bg-muted/50 hover:bg-muted/50"
                    onClick={() => void loadJobDetails(job)}
                  >
                    <TableCell className="pl-4">
                      <Badge
                        variant={badge.variant}
                        className={cn(badge.className, 'whitespace-nowrap')}
                      >
                        {badge.label}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <button
                        type="button"
                        className="group flex w-full items-center gap-2 rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        onClick={(event) => {
                          event.stopPropagation();
                          void loadJobDetails(job);
                        }}
                        aria-label={`View ${job.label} run details`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium text-foreground">{job.label}</span>
                          <code className="block truncate text-[10px] text-muted-foreground">{job.route}</code>
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </button>
                    </TableCell>
                    <TableCell className="hidden max-w-md text-xs text-muted-foreground lg:table-cell">
                      {job.description}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      every {formatInterval(job.expectedIntervalSeconds)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {entry
                        ? Object.entries(entry.outcomes)
                            .map(([outcome, count]) => `${outcome}: ${count}`)
                            .join(' · ')
                        : '—'}
                    </TableCell>
                    <TableCell className="pr-4 text-right text-xs text-muted-foreground">
                      {entry?.lastRunAt ? <ClientLocalDate value={entry.lastRunAt} /> : '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
