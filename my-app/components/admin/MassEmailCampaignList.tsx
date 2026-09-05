import type { MassEmailCampaign } from './MassEmailTypes';
import { statusTone } from './MassEmailViewUtils';

interface MassEmailCampaignListProps {
  campaigns: MassEmailCampaign[];
  selectedCampaignId: string | null;
  onSelectCampaign: (campaignId: string) => void;
}

export function MassEmailCampaignList({ campaigns, selectedCampaignId, onSelectCampaign }: MassEmailCampaignListProps) {
  return (
    <div className="max-h-136 space-y-2 overflow-y-auto">
      {campaigns.map((campaign) => (
        <button key={campaign.id} type="button" onClick={() => onSelectCampaign(campaign.id)} className={`w-full rounded-md border px-3 py-2 text-left ${selectedCampaignId === campaign.id ? 'border-blue-300 bg-blue-50 dark:bg-blue-950/40' : 'hover:bg-muted/50'}`}>
          <div className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium text-foreground">{campaign.subject}</span><span className={`rounded-full px-2 py-0.5 text-xs ${statusTone(campaign.status)}`}>{campaign.status}</span></div>
          <p className="mt-1 text-xs text-muted-foreground">{campaign.sentCount}/{campaign.eligibleRecipients} sent</p>
        </button>
      ))}
      {campaigns.length === 0 && <p className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">No mass email campaigns yet.</p>}
    </div>
  );
}
