'use client';

import CommunicationsTab from '@/components/admin/CommunicationsTab';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { AdminRoutePage, ModuleDisabledNotice } from '@/components/admin/AdminRoutePage';

export default function AdminCommunicationsClient({ disabled }: { disabled: boolean }) {
  return (
    <AdminRoutePage title="Communications" tabId="communications" category="communications">
      <AdminPageHeader
        title="Communications"
        description="Mass email campaigns and manual notification resends."
      />
      {disabled ? (
        <ModuleDisabledNotice title="Communications" />
      ) : (
        <CommunicationsTab />
      )}
    </AdminRoutePage>
  );
}
