'use client';

import AccountSyncStatusTab from '@/components/admin/AccountSyncStatusTab';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { AdminRoutePage } from '@/components/admin/AdminRoutePage';

export default function AdminSyncStatusPage() {
  return (
    <AdminRoutePage title="Sync Status" tabId="sync-status" category="sync_status">
      <AdminPageHeader
        title="Account Sync Status"
        description="Per-account directory synchronization state and history."
      />
      <AccountSyncStatusTab />
    </AdminRoutePage>
  );
}
