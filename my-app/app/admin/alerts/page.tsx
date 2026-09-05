'use client';

import ServiceAlertsPanel from '@/components/admin/ServiceAlertsPanel';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { AdminRoutePage } from '@/components/admin/AdminRoutePage';

export default function AdminAlertsPage() {
  return (
    <AdminRoutePage title="Service Alerts" tabId="alerts" category="navigation">
      <AdminPageHeader
        title="Service Alerts"
        description="Active alerts raised by monitoring and workflows."
      />
      <ServiceAlertsPanel />
    </AdminRoutePage>
  );
}
