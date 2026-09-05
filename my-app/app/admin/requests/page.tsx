'use client';

import AccessRequestsTab from '@/components/admin/AccessRequestsTab';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { AdminRoutePage } from '@/components/admin/AdminRoutePage';

export default function AdminRequestsPage() {
  return (
    <AdminRoutePage title="Access Requests" tabId="requests" category="access_request">
      <AdminPageHeader
        title="Access Requests"
        description="Review, approve, and provision portal access requests."
      />
      <AccessRequestsTab />
    </AdminRoutePage>
  );
}
