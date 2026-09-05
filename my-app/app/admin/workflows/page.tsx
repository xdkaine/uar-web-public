'use client';

import WorkflowsPanel from '@/components/admin/flow/WorkflowsPanel';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { AdminRoutePage } from '@/components/admin/AdminRoutePage';

export default function AdminWorkflowsPage() {
  return (
    <AdminRoutePage title="Workflows" tabId="automation" category="navigation">
      <AdminPageHeader
        title="Workflows"
        description="Connect operational sources to reviewed logic and queued actions. Monitoring checks now live inside the workflow that owns their outcomes."
      />
      <WorkflowsPanel />
    </AdminRoutePage>
  );
}
