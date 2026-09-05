'use client';

import SystemConfigurationTab from '@/components/admin/SystemConfigurationTab';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { AdminRoutePage } from '@/components/admin/AdminRoutePage';

export default function AdminSettingsPage() {
  return (
    <AdminRoutePage title="System Configuration" tabId="settings" category="settings">
      <AdminPageHeader
        title="System Configuration"
        description="Modules, messaging, privileges, directory, routing, and appearance."
      />
      <SystemConfigurationTab isLoading={false} onRefresh={() => {}} />
    </AdminRoutePage>
  );
}
