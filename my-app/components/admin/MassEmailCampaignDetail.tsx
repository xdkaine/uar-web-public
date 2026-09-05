import { CheckCircle, Edit3, Play, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MassEmailLocalizedTime from './MassEmailLocalizedTime';
import { MassEmailCampaignAudience } from './MassEmailCampaignAudience';
import type { CampaignAudienceFilter, CampaignAudienceRow, MassEmailCampaign } from './MassEmailTypes';
import { statusTone } from './MassEmailViewUtils';

interface MassEmailCampaignDetailProps {
  campaign: MassEmailCampaign | null;
  audienceRows: CampaignAudienceRow[];
  filteredAudienceRows: CampaignAudienceRow[];
  audienceCounts: Record<CampaignAudienceFilter, number>;
  audienceQuery: string;
  audienceFilter: CampaignAudienceFilter;
  isLoading: boolean;
  isWorking: boolean;
  onEditDraft: (campaign: MassEmailCampaign) => void;
  onCampaignAction: (campaignId: string, action: 'activate' | 'process' | 'cancel') => void;
  onAudienceQueryChange: (value: string) => void;
  onAudienceFilterChange: (filter: CampaignAudienceFilter) => void;
  onReconcileRecipient: (campaignId: string, recipientId: string, resolution: 'delivered' | 'not_delivered') => void;
}

export function MassEmailCampaignDetail({ campaign, audienceRows, filteredAudienceRows, audienceCounts, audienceQuery, audienceFilter, isLoading, isWorking, onEditDraft, onCampaignAction, onAudienceQueryChange, onAudienceFilterChange, onReconcileRecipient }: MassEmailCampaignDetailProps) {
  if (!campaign) return <p className="rounded-md border border-dashed px-3 py-8 text-center text-sm text-muted-foreground">Select a campaign to view progress.</p>;
  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h4 className="font-semibold text-foreground">{campaign.subject}</h4><p className="text-sm text-muted-foreground">{campaign.sentCount} sent, {campaign.failedCount} failed, {campaign.skippedRecipients} skipped</p></div>
        <div className="flex flex-wrap gap-2">
          {campaign.status === 'draft' && <><Button type="button" variant="outline" onClick={() => onEditDraft(campaign)} disabled={isWorking || isLoading || !campaign.html} className="gap-2"><Edit3 className="h-4 w-4" /> Edit Draft</Button><Button type="button" onClick={() => onCampaignAction(campaign.id, 'activate')} disabled={isWorking} className="gap-2"><Play className="h-4 w-4" /> Activate</Button></>}
          {campaign.status === 'active' && <Button type="button" variant="outline" onClick={() => onCampaignAction(campaign.id, 'process')} disabled={isWorking} className="gap-2"><Play className="h-4 w-4" /> Process Batch</Button>}
          {(campaign.status === 'draft' || campaign.status === 'active') && <Button type="button" variant="outline" onClick={() => onCampaignAction(campaign.id, 'cancel')} disabled={isWorking} className="gap-2 text-red-700 dark:text-red-200"><XCircle className="h-4 w-4" /> Cancel</Button>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4"><div className="rounded-md border p-3"><p className="text-muted-foreground">Eligible</p><p className="font-semibold">{campaign.eligibleRecipients}</p></div><div className="rounded-md border p-3"><p className="text-muted-foreground">Sent</p><p className="font-semibold text-green-700 dark:text-green-200">{campaign.sentCount}</p></div><div className="rounded-md border p-3"><p className="text-muted-foreground">Failed</p><p className="font-semibold text-red-700 dark:text-red-200">{campaign.failedCount}</p></div><div className="rounded-md border p-3"><p className="text-muted-foreground">Skipped</p><p className="font-semibold">{campaign.skippedRecipients}</p></div></div>
      <section className="rounded-md border">
        <div className="flex flex-col gap-2 border-b px-3 py-3 sm:flex-row sm:items-center sm:justify-between"><div><h5 className="text-sm font-semibold text-foreground">Message</h5><p className="text-xs text-muted-foreground">{campaign.subject}</p></div><span className={`w-fit rounded-full px-2 py-0.5 text-xs ${statusTone(campaign.status)}`}>{campaign.status}</span></div>
        {isLoading ? <p className="px-3 py-4 text-sm text-muted-foreground">Loading campaign message...</p> : campaign.html ? <iframe title="Mass email campaign message" sandbox="" srcDoc={campaign.html} className="h-80 w-full border-0 bg-card" /> : <p className="px-3 py-4 text-sm text-muted-foreground">No message details loaded for this campaign.</p>}
      </section>
      <MassEmailCampaignAudience rows={audienceRows} filteredRows={filteredAudienceRows} counts={audienceCounts} query={audienceQuery} filter={audienceFilter} isLoading={isLoading} isWorking={isWorking} campaignId={campaign.id} onQueryChange={onAudienceQueryChange} onFilterChange={onAudienceFilterChange} onReconcileRecipient={onReconcileRecipient} />
      <details className="rounded-md border"><summary className="cursor-pointer px-3 py-2 text-sm font-medium text-muted-foreground">Activity log</summary><div className="border-t">{isLoading ? <p className="px-3 py-4 text-sm text-muted-foreground">Loading campaign activity...</p> : (campaign.logs || []).length > 0 ? (campaign.logs || []).slice(0, 6).map((log) => <div key={log.id} className="flex items-start gap-2 border-b px-3 py-2 text-xs last:border-b-0">{log.level === 'error' ? <XCircle className="mt-0.5 h-3 w-3 text-red-600 dark:text-red-400" /> : <CheckCircle className="mt-0.5 h-3 w-3 text-green-600 dark:text-green-400" />}<div><p className="font-medium text-foreground">{log.message}</p><p className="text-muted-foreground"><MassEmailLocalizedTime value={log.createdAt} /></p></div></div>) : <p className="px-3 py-4 text-sm text-muted-foreground">No activity recorded for this campaign.</p>}</div></details>
    </>
  );
}
