import { ChevronLeft, ChevronRight, Eye } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { paginationItems } from '@/lib/pagination';
import type { ActionHistoryItem, ActionHistoryResponse } from '@/types/api';
import { ClientLocalDate } from './ClientLocalDate';

function badgeVariant(outcome: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  if (outcome === 'failure' || outcome === 'denied') return 'destructive';
  if (outcome === 'pending' || outcome === 'skipped') return 'secondary';
  if (outcome === 'rollback') return 'outline';
  return 'default';
}

function compactText(value: string, maxLength = 220): string {
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function subjectLabel(item: ActionHistoryItem): string {
  return item.subjectName || item.subjectUsername || item.subjectEmail || item.relatedRequestId || item.relatedVpnAccountId || 'Unknown';
}

function relatedLabel(item: ActionHistoryItem): string {
  if (item.relatedRequestId) return `Request ${item.relatedRequestId}`;
  if (item.relatedVpnAccountId) return `VPN ${item.relatedVpnAccountId}`;
  if (item.relatedLifecycleActionId) return `Lifecycle ${item.relatedLifecycleActionId}`;
  if (item.targetType && item.targetId) return `${item.targetType} ${item.targetId}`;
  return 'None';
}

interface ActionHistoryResultsProps {
  history: ActionHistoryResponse | null;
  isLoading: boolean;
  submittedLookup: string;
  pageSize: number;
  onPageSizeChange: (size: number) => void;
  onPageChange: (page: number | ((current: number) => number)) => void;
  onItemSelect: (item: ActionHistoryItem) => void;
}

export function ActionHistoryResults({
  history,
  isLoading,
  submittedLookup,
  pageSize,
  onPageSizeChange,
  onPageChange,
  onItemSelect,
}: ActionHistoryResultsProps) {
  const canGoBack = (history?.page || 1) > 1;
  const canGoForward = history ? history.page < history.totalPages : false;

  return (
    <div className="rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Results for {submittedLookup}</h3>
          {history && <p className="text-xs text-muted-foreground">{history.total} matching event{history.total === 1 ? '' : 's'}</p>}
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="action-history-page-size" className="text-xs text-muted-foreground">Rows</Label>
          <Select value={String(pageSize)} onValueChange={(value) => onPageSizeChange(Number(value))}>
            <SelectTrigger id="action-history-page-size" className="h-8 w-[92px]"><SelectValue /></SelectTrigger>
            <SelectContent>{[10, 25, 50, 100].map((size) => <SelectItem key={size} value={String(size)}>{size}</SelectItem>)}</SelectContent>
          </Select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <Table className="table-fixed min-w-[1120px]">
          <TableHeader><TableRow><TableHead className="w-40">Time</TableHead><TableHead className="w-48">Subject</TableHead><TableHead className="w-[320px]">Action</TableHead><TableHead className="w-36">Actor</TableHead><TableHead className="w-36">IP</TableHead><TableHead className="w-28">Event</TableHead><TableHead className="w-48">Related</TableHead><TableHead className="w-16" /></TableRow></TableHeader>
          <TableBody>
            {isLoading && !history ? <LoadingRow /> : history && history.items.length > 0 ? history.items.map((item) => <HistoryRow key={item.id} item={item} onSelect={onItemSelect} />) : <EmptyRow />}
          </TableBody>
        </Table>
      </div>

      {history && (
        <div className="flex flex-col items-center justify-between gap-3 border-t border-border p-4 sm:flex-row">
          <Button type="button" variant="outline" size="sm" disabled={!canGoBack || isLoading} onClick={() => onPageChange((current) => Math.max(1, current - 1))}><ChevronLeft className="h-4 w-4" />Previous</Button>
          <div className="flex items-center gap-1" aria-label={`Page ${history.page} of ${history.totalPages}`}>
            {paginationItems(history.page, history.totalPages).map((item, index) => item === 'ellipsis' ? <span key={`ellipsis-${index}`} className="w-8 text-center text-xs text-muted-foreground">…</span> : <Button key={item} type="button" variant={item === history.page ? 'default' : 'ghost'} size="sm" className="h-8 min-w-8 px-2" disabled={isLoading} onClick={() => onPageChange(item)} aria-current={item === history.page ? 'page' : undefined}>{item}</Button>)}
          </div>
          <Button type="button" variant="outline" size="sm" disabled={!canGoForward || isLoading} onClick={() => onPageChange((current) => current + 1)}>Next<ChevronRight className="h-4 w-4" /></Button>
        </div>
      )}
    </div>
  );
}

function LoadingRow() { return <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">Loading action history...</TableCell></TableRow>; }
function EmptyRow() { return <TableRow><TableCell colSpan={8} className="h-24 text-center text-muted-foreground">No history events matched this lookup.</TableCell></TableRow>; }

function HistoryRow({ item, onSelect }: { item: ActionHistoryItem; onSelect: (item: ActionHistoryItem) => void }) {
  return (
    <TableRow>
      <TableCell className="text-xs text-muted-foreground"><ClientLocalDate value={item.createdAt} /></TableCell>
      <TableCell className="whitespace-normal"><div className="space-y-0.5"><div className="font-medium text-foreground wrap-break-word">{subjectLabel(item)}</div>{item.subjectName && (item.subjectUsername || item.subjectEmail) && <div className="text-xs text-muted-foreground wrap-break-word">{[item.subjectUsername, item.subjectEmail].filter(Boolean).join(' / ')}</div>}{!item.subjectName && item.subjectUsername && item.subjectEmail && <div className="text-xs text-muted-foreground wrap-break-word">{item.subjectEmail}</div>}</div></TableCell>
      <TableCell className="whitespace-normal"><div className="min-w-0 space-y-0.5"><div className="font-medium text-foreground wrap-break-word">{compactText(item.title, 120)}</div>{item.description && <div className="line-clamp-2 text-xs text-muted-foreground wrap-break-word" title={item.description}>{compactText(item.description)}</div>}</div></TableCell>
      <TableCell className="whitespace-normal"><div className="text-sm text-foreground wrap-break-word">{item.actor}</div><div className="text-xs text-muted-foreground capitalize">{item.actorType}</div></TableCell>
      <TableCell className="text-xs text-muted-foreground whitespace-normal wrap-break-word">{item.ipAddress || <span className="text-muted-foreground">None</span>}</TableCell>
      <TableCell><div className="flex flex-col gap-1"><Badge variant="outline" className="w-fit capitalize">{item.eventKind}</Badge><Badge variant={badgeVariant(item.outcome)} className="w-fit capitalize">{item.outcome}</Badge></div></TableCell>
      <TableCell className="text-xs text-muted-foreground whitespace-normal wrap-break-word">{relatedLabel(item)}</TableCell>
      <TableCell><Button type="button" variant="ghost" size="sm" onClick={() => onSelect(item)}><Eye className="h-4 w-4" /><span className="sr-only">View details</span></Button></TableCell>
    </TableRow>
  );
}
