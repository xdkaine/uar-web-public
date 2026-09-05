import { Search } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { ResolutionListItem, ResolutionResponse } from './MassEmailTypes';
import { formatReason, sourceSummary } from './MassEmailViewUtils';

interface DryRunRecipientListProps {
  items: ResolutionListItem[];
  emptyMessage: string;
  tone: 'candidate' | 'eligible' | 'skipped';
}

function DryRunRecipientList({ items, emptyMessage, tone }: DryRunRecipientListProps) {
  if (items.length === 0) return <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">{emptyMessage}</p>;
  const toneClass = tone === 'eligible' ? 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-200' : tone === 'skipped' ? 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-200' : 'bg-muted text-muted-foreground';
  return (
    <div className="max-h-120 overflow-auto rounded-md border">
      <table className="w-full min-w-[720px] text-left text-sm">
        <thead className="sticky top-0 bg-muted/50 text-xs font-medium uppercase text-muted-foreground"><tr><th scope="col" className="border-b px-3 py-2">Recipient</th><th scope="col" className="border-b px-3 py-2">Username</th><th scope="col" className="border-b px-3 py-2">Source</th><th scope="col" className="border-b px-3 py-2">Status</th></tr></thead>
        <tbody>{items.map((item) => {
          const title = item.displayName || item.email || item.adUsername || 'Unknown recipient';
          const sourceText = sourceSummary(item.sources);
          const badgeText = tone === 'skipped' || item.reason ? formatReason(item.reason) : tone;
          const badgeClass = item.reason ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-200' : toneClass;
          return <tr key={`${item.email || item.adUsername || title}-${sourceText}`} className="border-b last:border-b-0 hover:bg-muted/50"><td className="max-w-[260px] px-3 py-2 align-top"><p className="truncate font-medium text-foreground">{title}</p>{item.email && <p className="truncate text-xs text-muted-foreground">{item.email}</p>}</td><td className="max-w-40 px-3 py-2 align-top text-xs text-muted-foreground"><span className="block truncate">{item.adUsername || '-'}</span></td><td className="max-w-72 px-3 py-2 align-top text-xs text-muted-foreground"><span className="block truncate" title={sourceText}>{sourceText}</span></td><td className="px-3 py-2 align-top"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass}`}>{badgeText || tone}</span></td></tr>;
        })}</tbody>
      </table>
    </div>
  );
}

interface MassEmailDryRunProps {
  resolution: ResolutionResponse | null;
  resolutionIsFresh: boolean;
  dryRunQuery: string;
  filteredCandidates: ResolutionListItem[];
  filteredRecipients: ResolutionListItem[];
  filteredSkipped: ResolutionListItem[];
  candidateCount: number;
  onDryRunQueryChange: (value: string) => void;
}

export function MassEmailDryRun({ resolution, resolutionIsFresh, dryRunQuery, filteredCandidates, filteredRecipients, filteredSkipped, candidateCount, onDryRunQueryChange }: MassEmailDryRunProps) {
  return (
    <section className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div><h3 className="font-semibold text-foreground">Dry Run</h3>{resolution && <p className="text-xs text-muted-foreground">{resolutionIsFresh ? 'Showing the current resolved audience.' : 'Audience selection changed. Run the dry run again before sending.'}</p>}</div>
        {resolution && <div className="relative w-full lg:max-w-md"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><input value={dryRunQuery} onChange={(event) => onDryRunQueryChange(event.target.value)} className="w-full rounded-md border bg-card py-2 pl-9 pr-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500" aria-label="Search dry-run recipients" placeholder="Search name, email, username, source, or reason" /></div>}
      </div>
      {resolution ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4"><div className="rounded-md border p-3"><p className="text-muted-foreground">Candidates</p><p className="font-semibold">{resolution.summary.totalCandidates}</p></div><div className="rounded-md border p-3"><p className="text-muted-foreground">Eligible</p><p className="font-semibold text-green-700 dark:text-green-200">{resolution.summary.eligibleRecipients}</p></div><div className="rounded-md border p-3"><p className="text-muted-foreground">Skipped</p><p className="font-semibold text-red-700 dark:text-red-200">{resolution.summary.skippedRecipients}</p></div><div className="rounded-md border p-3"><p className="text-muted-foreground">Merged</p><p className="font-semibold">{resolution.summary.duplicateSourcesMerged}</p></div></div>
          <Tabs defaultValue="candidates" className="space-y-3">
            <TabsList className="grid w-full grid-cols-3 lg:w-auto lg:inline-grid"><TabsTrigger value="candidates" className="gap-2">Candidates <span className="text-[11px] text-muted-foreground">{filteredCandidates.length}/{candidateCount}</span></TabsTrigger><TabsTrigger value="eligible" className="gap-2">Eligible <span className="text-[11px] text-muted-foreground">{filteredRecipients.length}/{resolution.recipients.length}</span></TabsTrigger><TabsTrigger value="skipped" className="gap-2">Skipped <span className="text-[11px] text-muted-foreground">{filteredSkipped.length}/{resolution.skipped.length}</span></TabsTrigger></TabsList>
            <TabsContent value="candidates"><DryRunRecipientList items={filteredCandidates} emptyMessage={dryRunQuery.trim() ? 'No candidates match the current search.' : 'No candidates resolved.'} tone="candidate" /></TabsContent>
            <TabsContent value="eligible"><DryRunRecipientList items={filteredRecipients} emptyMessage={dryRunQuery.trim() ? 'No eligible recipients match the current search.' : 'No eligible recipients.'} tone="eligible" /></TabsContent>
            <TabsContent value="skipped"><DryRunRecipientList items={filteredSkipped} emptyMessage={dryRunQuery.trim() ? 'No skipped recipients match the current search.' : 'No skipped recipients.'} tone="skipped" /></TabsContent>
          </Tabs>
        </div>
      ) : <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">Run a dry run to resolve the selected audience.</p>}
    </section>
  );
}
