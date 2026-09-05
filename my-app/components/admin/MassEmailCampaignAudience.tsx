import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MassEmailLocalizedTime from './MassEmailLocalizedTime';
import type { CampaignAudienceFilter, CampaignAudienceRow } from './MassEmailTypes';
import { formatReason, statusTone } from './MassEmailViewUtils';

interface MassEmailCampaignAudienceProps {
  rows: CampaignAudienceRow[];
  filteredRows: CampaignAudienceRow[];
  counts: Record<CampaignAudienceFilter, number>;
  query: string;
  filter: CampaignAudienceFilter;
  isLoading: boolean;
  isWorking: boolean;
  campaignId: string;
  onQueryChange: (value: string) => void;
  onFilterChange: (filter: CampaignAudienceFilter) => void;
  onReconcileRecipient: (campaignId: string, recipientId: string, resolution: 'delivered' | 'not_delivered') => void;
}

export function MassEmailCampaignAudience({ rows, filteredRows, counts, query, filter, isLoading, isWorking, campaignId, onQueryChange, onFilterChange, onReconcileRecipient }: MassEmailCampaignAudienceProps) {
  const filters: Array<[CampaignAudienceFilter, string, number]> = [['all', 'All', counts.all], ['eligible', 'Eligible', counts.eligible], ['skipped', 'Skipped', counts.skipped], ['sent', 'Sent', counts.sent], ['failed', 'Failed', counts.failed], ['delivery_unknown', 'Unknown', counts.delivery_unknown]];
  return (
    <section className="rounded-md border">
      <div className="space-y-3 border-b px-3 py-3">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between"><div><h5 className="text-sm font-semibold text-foreground">Audience</h5><p className="text-xs text-muted-foreground">Showing {filteredRows.length} of {rows.length} loaded audience records</p></div><div className="relative w-full xl:max-w-sm"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><input value={query} onChange={(event) => onQueryChange(event.target.value)} className="w-full rounded-md border bg-card py-2 pl-9 pr-3 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500" aria-label="Search campaign audience" placeholder="Search name, email, username, source, or reason" /></div></div>
        <div className="flex flex-wrap gap-2">{filters.map(([nextFilter, label, count]) => <button key={nextFilter} type="button" onClick={() => onFilterChange(nextFilter)} aria-pressed={filter === nextFilter} className={`inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium ${filter === nextFilter ? 'border-blue-300 bg-blue-50 dark:bg-blue-950/40 text-blue-800' : 'bg-card text-muted-foreground hover:bg-muted/50'}`}>{label}<span className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{count}</span></button>)}</div>
      </div>
      {isLoading ? <p className="px-3 py-4 text-sm text-muted-foreground">Loading campaign audience...</p> : rows.length > 0 ? (
        <div className="max-h-136 overflow-auto">
          <table className="w-full min-w-[820px] text-left text-sm"><thead className="sticky top-0 bg-muted/50 text-xs font-medium uppercase text-muted-foreground"><tr><th scope="col" className="border-b px-3 py-2">Recipient</th><th scope="col" className="border-b px-3 py-2">Username</th><th scope="col" className="border-b px-3 py-2">Status</th><th scope="col" className="border-b px-3 py-2">Source</th><th scope="col" className="border-b px-3 py-2">Notes</th><th scope="col" className="border-b px-3 py-2">Recovery</th></tr></thead>
            <tbody>{filteredRows.map((row) => <tr key={row.key} className="border-b last:border-b-0 hover:bg-muted/50"><td className="max-w-[260px] px-3 py-2 align-top"><p className="truncate font-medium text-foreground">{row.displayName || row.email || row.adUsername || 'Unknown recipient'}</p>{row.email && <p className="truncate text-xs text-muted-foreground">{row.email}</p>}</td><td className="max-w-40 px-3 py-2 align-top text-xs text-muted-foreground"><span className="block truncate">{row.adUsername || '-'}</span></td><td className="px-3 py-2 align-top"><span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusTone(row.status)}`}>{formatReason(row.status)}</span></td><td className="max-w-[220px] px-3 py-2 align-top text-xs text-muted-foreground"><span className="block truncate" title={row.sourceText}>{row.sourceText}</span></td><td className="max-w-60 px-3 py-2 align-top text-xs text-muted-foreground">{row.note ? <span className="block truncate" title={row.note}>{row.note}</span> : row.sentAt ? <span className="block truncate">Sent <MassEmailLocalizedTime value={row.sentAt} /></span> : '-'}</td><td className="px-3 py-2 align-top">{row.status === 'delivery_unknown' && row.recipientId ? <div className="flex gap-1"><Button size="sm" variant="outline" disabled={isWorking} onClick={() => onReconcileRecipient(campaignId, row.recipientId!, 'delivered')}>Delivered</Button><Button size="sm" variant="outline" disabled={isWorking} onClick={() => onReconcileRecipient(campaignId, row.recipientId!, 'not_delivered')}>Retry</Button></div> : '-'}</td></tr>)}</tbody>
          </table>
          {filteredRows.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted-foreground">No audience records match the current filters.</p>}
        </div>
      ) : <p className="px-3 py-4 text-sm text-muted-foreground">No audience details loaded for this campaign.</p>}
    </section>
  );
}
