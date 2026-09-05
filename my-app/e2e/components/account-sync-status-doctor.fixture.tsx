import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import AccountSyncStatusTab from '@/components/admin/AccountSyncStatusTab';

const accountA = { identifier: 'fixture.user', name: 'Fixture User', email: 'fixture.user@example.test', hasAdAccount: true, adUsername: 'fixture.user', adDisplayName: 'Fixture User', adEmail: 'fixture.user@example.test', adAccountEnabled: true, adSyncDate: '2026-09-04T14:15:16.000Z', hasVpnAccount: false, vpnUsername: null, vpnPortalType: null, vpnStatus: null, vpnCreatedAt: null, hasAccessRequest: false, requestId: null, requestStatus: null, requestCreatedAt: null, isManuallyAssigned: false, syncStatus: 'orphaned' as const, syncIssues: ['Missing managed request', 'Missing managed request'], lastSyncId: 'sync-fixture-1', wasAutoAssigned: false, resolutionKind: 'create_request_link' as const };
const accountB = { ...accountA, identifier: 'prop-b.user', name: 'Prop B User', adUsername: 'prop-b.user', adDisplayName: 'Prop B User' };
const accountsA = [accountA];
const accountsB = [accountB];
const latestSyncA = { id: 'sync-fixture-1', createdAt: '2026-09-04T14:00:00.000Z', completedAt: '2026-09-04T14:15:16.000Z', status: 'completed', totalADAccounts: 1, totalVPNAccounts: 0, matchedAccounts: 0, unmatchedAD: 1, unmatchedVPN: 0, autoAssigned: 0 };
const latestSyncB = { ...latestSyncA, id: 'sync-fixture-prop-b', totalADAccounts: 22 };

function SyncStatusFixture() {
  const [useBProps, setUseBProps] = useState(false);
  const accounts = useBProps ? accountsB : accountsA;
  const latestSync = useBProps ? latestSyncB : latestSyncA;
  return <main className="min-h-screen bg-background p-4 sm:p-8"><button type="button" onClick={() => setUseBProps(true)}>Use prop B</button><AccountSyncStatusTab accounts={accounts} latestSync={latestSync} /></main>;
}

createRoot(document.getElementById('root')!).render(<SyncStatusFixture />);
