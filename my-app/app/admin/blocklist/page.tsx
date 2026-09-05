'use client';

import BlocklistTab from '@/components/admin/BlocklistTab';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { AdminRoutePage } from '@/components/admin/AdminRoutePage';

export default function AdminBlocklistPage() {
  return (
    <AdminRoutePage title="Blocklist" tabId="blocklist" category="blocklist">
      <AdminPageHeader
        title="Blocklist"
        description="Emails and domains blocked from submitting access requests."
      />
      <BlocklistTab />
    </AdminRoutePage>
  );
}
