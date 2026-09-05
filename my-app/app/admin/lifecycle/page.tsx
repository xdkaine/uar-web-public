'use client';

import AccountLifecycleTab from '@/components/admin/AccountLifecycleTab';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { AdminRoutePage } from '@/components/admin/AdminRoutePage';

export default function AdminLifecyclePage() {
  return (
    <AdminRoutePage title="Account Lifecycle" tabId="lifecycle" category="lifecycle">
      <AdminPageHeader
        title="Account Lifecycle"
        description="Plan account changes across application records, Active Directory, VPN, and group membership."
      />
      <AccountLifecycleTab />
    </AdminRoutePage>
  );
}
