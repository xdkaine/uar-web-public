'use client';

import SessionManagementTab from '@/components/admin/SessionManagementTab';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { AdminRoutePage } from '@/components/admin/AdminRoutePage';

export default function AdminSessionsPage() {
  return (
    <AdminRoutePage title="Active Sessions" tabId="sessions" category="session">
      <AdminPageHeader
        title="Active Sessions"
        description="Signed-in sessions with activity and forced sign-out."
      />
      <SessionManagementTab />
    </AdminRoutePage>
  );
}
