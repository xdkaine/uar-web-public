'use client';

import OperationsDashboardPanel from '@/components/admin/flow/OperationsDashboardPanel';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { AdminRoutePage } from '@/components/admin/AdminRoutePage';

export default function AdminOperationsPage() {
  return (
    <AdminRoutePage title="Scheduler Health" tabId="operations" category="navigation">
      <AdminPageHeader
        title="Scheduler Health"
        description="Cron job cadence, outcomes, and latest executions."
      />
      <OperationsDashboardPanel />
    </AdminRoutePage>
  );
}
