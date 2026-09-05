import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ClientLocalDate } from './ClientLocalDate';
import type { LatestSyncInfo, SyncStatusStats } from './AccountSyncStatusTypes';

interface AccountSyncStatusSummaryProps { latestSync: LatestSyncInfo | null; stats: SyncStatusStats; }

export function AccountSyncStatusSummary({ latestSync, stats }: AccountSyncStatusSummaryProps) {
  return <>
    {latestSync && <Card><CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2"><CardTitle className="text-lg font-semibold">Latest Sync Information</CardTitle><Badge variant={latestSync.status === 'completed' ? 'default' : latestSync.status === 'running' ? 'secondary' : 'destructive'}>{latestSync.status.charAt(0).toUpperCase() + latestSync.status.slice(1)}</Badge></CardHeader><CardContent><div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6"><Stat label="Started" value={<ClientLocalDate value={latestSync.createdAt} />} />{latestSync.completedAt && <Stat label="Completed" value={<ClientLocalDate value={latestSync.completedAt} />} />}<Stat label="AD Accounts" value={latestSync.totalADAccounts} /><Stat label="VPN Accounts" value={latestSync.totalVPNAccounts} /><Stat label="Matched" value={latestSync.matchedAccounts} className="text-green-600 dark:text-green-400" /><Stat label="Auto-Assigned" value={latestSync.autoAssigned} className="text-blue-600 dark:text-blue-400" /></div></CardContent></Card>}
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-6"><Metric label="Total Accounts" value={stats.total} /><Metric label="Fully Synced" value={stats.fullySynced} className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/40" /><Metric label="Partial Sync" value={stats.partialSync} className="border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/40" /><Metric label="With Issues" value={stats.withIssues} className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40" /><Metric label="AD Only" value={stats.adOnly} className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40" /><Metric label="VPN Only" value={stats.vpnOnly} className="border-purple-200 bg-purple-50 dark:border-purple-900 dark:bg-purple-950/40" /></div>
  </>;
}

function Stat({ label, value, className = '' }: { label: string; value: React.ReactNode; className?: string }) { return <div><p className="text-sm text-muted-foreground">{label}</p><p className={`text-lg font-semibold text-foreground ${className}`}>{value}</p></div>; }
function Metric({ label, value, className = '' }: { label: string; value: number; className?: string }) { return <Card className={className}><CardContent className="p-4"><p className="text-sm text-muted-foreground">{label}</p><p className="text-2xl font-bold text-foreground">{value}</p></CardContent></Card>; }
