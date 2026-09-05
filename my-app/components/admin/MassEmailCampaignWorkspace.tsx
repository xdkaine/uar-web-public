import type { ComponentProps, ReactNode } from 'react';
import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import MassEmailLocalizedTime from './MassEmailLocalizedTime';
import { MassEmailCampaignList } from './MassEmailCampaignList';

interface CampaignWorkspaceProps extends ComponentProps<
  typeof MassEmailCampaignList
> {
  children: ReactNode;
  lastUpdated: Date | null;
  isLoading: boolean;
  refresh: () => Promise<void>;
}

export function MassEmailCampaignWorkspace({
  campaigns,
  selectedCampaignId: effectiveSelectedCampaignId,
  onSelectCampaign: selectCampaign,
  lastUpdated,
  isLoading,
  refresh,
  children,
}: CampaignWorkspaceProps) {
  return (
    <section className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="font-semibold text-foreground">Campaigns</h3>
          <p className="text-xs text-muted-foreground">
            {lastUpdated ? (
              <>
                Updated <MassEmailLocalizedTime value={lastUpdated} timeOnly />
              </>
            ) : (
              'Loading campaigns'
            )}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={refresh}
          disabled={isLoading}
          className="gap-2"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[300px_minmax(0,1fr)]">
        <MassEmailCampaignList
          campaigns={campaigns}
          selectedCampaignId={effectiveSelectedCampaignId}
          onSelectCampaign={selectCampaign}
        />
        <div className="min-w-0 space-y-4">{children}</div>
      </div>
    </section>
  );
}
