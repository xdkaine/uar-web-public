import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AccountName } from './AccountName';
import { formatLogCount, getActionDisplayName, getCategoryTone, getLogOutcomePresentation } from './LogsHelpers';
import { LogsLocalizedDateTime } from './LogsLocalizedTime';
import type { AuditLog } from './LogsTypes';

interface LogsTableProps {
  logs: AuditLog[];
  totalLogs: number;
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  onSelectLog: (log: AuditLog) => void;
}

export function LogsTable({ logs, totalLogs, currentPage, totalPages, onPageChange, onSelectLog }: LogsTableProps) {
  return <section aria-labelledby="audit-logs-heading" className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
    <div className="flex flex-col gap-1 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between"><h2 id="audit-logs-heading" className="text-base font-semibold text-foreground">Audit logs</h2><span className="text-sm text-muted-foreground">{formatLogCount(totalLogs)} matching</span></div>
    <div className="overflow-x-auto"><Table>
      <TableHeader className="bg-muted/50"><TableRow><TableHead className="min-w-40">Time</TableHead><TableHead className="min-w-44">Event</TableHead><TableHead className="min-w-40">Actor</TableHead><TableHead className="min-w-40">Subject</TableHead><TableHead className="min-w-28">Outcome</TableHead><TableHead className="w-24 text-right">Details</TableHead></TableRow></TableHeader>
      <TableBody>{logs.length === 0 ? <TableRow><TableCell colSpan={6} className="h-28 text-center text-muted-foreground">No audit logs match these filters.</TableCell></TableRow> : logs.map((log) => <TableRow key={log.id} className="hover:bg-muted/50">
        <TableCell className="whitespace-nowrap text-sm"><LogsLocalizedDateTime value={log.createdAt} /></TableCell>
        <TableCell><div className="font-medium">{getActionDisplayName(log.action)}</div><StatusBadge tone={getCategoryTone(log.category)} emphasis="outline" className="mt-1 capitalize">{log.category}</StatusBadge></TableCell>
        <TableCell><AccountName username={log.username} displayName={log.actorDisplayName} />{log.actorType && <div className="mt-1 text-xs capitalize text-muted-foreground">{log.actorType}</div>}</TableCell>
        <TableCell><SubjectCell log={log} /></TableCell>
        <TableCell><OutcomeBadge log={log} /></TableCell>
        <TableCell className="text-right"><Button type="button" variant="outline" size="sm" onClick={() => onSelectLog(log)} aria-label={`View details for ${getActionDisplayName(log.action)}`}>View</Button></TableCell>
      </TableRow>)}</TableBody>
    </Table></div>
    {totalPages > 1 && <div className="flex flex-col items-center justify-between gap-3 border-t border-border bg-muted/30 px-4 py-3 sm:flex-row"><span className="text-sm text-muted-foreground">Page {currentPage} of {totalPages}</span><div className="flex gap-2"><Button type="button" variant="outline" size="sm" onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage === 1}><ChevronLeft aria-hidden="true" className="h-4 w-4" />Previous</Button><Button type="button" variant="outline" size="sm" onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage === totalPages}>Next<ChevronRight aria-hidden="true" className="h-4 w-4" /></Button></div></div>}
  </section>;
}

function SubjectCell({ log }: { log: AuditLog }) {
  if (log.subjectUsername || log.subjectDisplayName) return <div><AccountName username={log.subjectUsername} displayName={log.subjectDisplayName} />{log.subjectEmail && <div className="mt-1 max-w-52 truncate text-xs text-muted-foreground">{log.subjectEmail}</div>}</div>;
  return log.subjectEmail ? <span className="max-w-52 break-all text-sm text-muted-foreground">{log.subjectEmail}</span> : <span className="text-muted-foreground">—</span>;
}

function OutcomeBadge({ log }: { log: AuditLog }) {
  const outcome = getLogOutcomePresentation(log.outcome, log.success);
  return <StatusBadge tone={outcome.tone}>{outcome.label}</StatusBadge>;
}
