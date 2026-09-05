import { Button } from '@/components/ui/button';
import { RefreshCw } from 'lucide-react';
import { LogsLocalizedTime } from './LogsLocalizedTime';

interface LogsSummaryProps {
  error: Error | null;
  lastUpdated: Date | null;
  isPolling: boolean;
  isPollingLoading: boolean;
  onTogglePolling: () => void;
  onRefresh: () => Promise<void>;
}

export function LogsSummary({ error, lastUpdated, isPolling, isPollingLoading, onTogglePolling, onRefresh }: LogsSummaryProps) {
  return <div className="space-y-2">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{error && !lastUpdated ? 'Audit logs unavailable' : lastUpdated ? <>Updated <LogsLocalizedTime value={lastUpdated} /></> : 'Loading current audit activity…'}</p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" aria-pressed={isPolling} onClick={onTogglePolling} className="gap-1.5"><span aria-hidden="true" className={`h-2 w-2 rounded-full ${isPolling ? 'bg-emerald-500' : 'bg-muted-foreground'}`} />{isPolling ? 'Live' : 'Paused'}</Button>
        <Button type="button" variant="outline" size="sm" onClick={() => void onRefresh()} disabled={isPollingLoading} className="gap-1.5"><RefreshCw aria-hidden="true" className={`h-3.5 w-3.5 ${isPollingLoading ? 'animate-spin' : ''}`} />Refresh</Button>
      </div>
    </div>
    {error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"><span>{error.message} {lastUpdated ? 'Showing the last loaded results.' : ''}</span><Button type="button" variant="outline" size="sm" onClick={() => void onRefresh()} disabled={isPollingLoading}>Retry</Button></div>}
  </div>;
}
