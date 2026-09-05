'use client';

import EventManagementTab from '@/components/admin/EventManagementTab';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { AdminRoutePage } from '@/components/admin/AdminRoutePage';

export default function AdminEventsPage() {
  return (
    <AdminRoutePage title="Events" tabId="events" category="event">
      <AdminPageHeader
        title="Events"
        description="Manage the event catalog offered inside access requests."
      />
      <EventManagementTab />
    </AdminRoutePage>
  );
}
