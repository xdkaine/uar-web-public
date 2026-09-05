import { StatusBadge, type StatusTone } from '@/components/ui/status-badge';
import type { SyncStatusAccount } from './AccountSyncStatusTypes';

const TONES: Record<SyncStatusAccount['syncStatus'], StatusTone> = {
  fully_synced: 'success', partial_sync: 'warning', ad_only: 'info', vpn_only: 'info', request_only: 'warning', offboarded: 'neutral', orphaned: 'danger',
};
const LABELS: Record<SyncStatusAccount['syncStatus'], string> = {
  fully_synced: 'Fully Synced', partial_sync: 'Partial Sync', ad_only: 'AD Only', vpn_only: 'VPN Only', request_only: 'Request Only', offboarded: 'Offboarded', orphaned: 'Orphaned',
};

export function AccountSyncStatusBadge({ status }: { status: SyncStatusAccount['syncStatus'] }) {
  return <StatusBadge tone={TONES[status]} emphasis="outline" className="font-normal">{LABELS[status]}</StatusBadge>;
}
