'use client';

import SupportTicketsTab from '@/components/admin/SupportTicketsTab';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { AdminRoutePage } from '@/components/admin/AdminRoutePage';

export default function AdminSupportPage() {
  return (
    <AdminRoutePage title="Support Tickets" tabId="support" category="support">
      <AdminPageHeader
        title="Support Tickets"
        description="Respond to, assign, and resolve portal support tickets."
      />
      <SupportTicketsTab />
    </AdminRoutePage>
  );
}
