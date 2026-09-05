'use client';

import VPNManagementTab from '@/components/admin/VPNManagementTab';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { AdminRoutePage, ModuleDisabledNotice } from '@/components/admin/AdminRoutePage';

export default function AdminVpnClient({ disabled }: { disabled: boolean }) {
  return (
    <AdminRoutePage title="VPN Management" tabId="vpn" category="vpn">
      <AdminPageHeader
        title="VPN Management"
        description="VPN accounts, imports, portal roles, and status changes."
      />
      {disabled ? (
        <ModuleDisabledNotice title="VPN Management" />
      ) : (
        <VPNManagementTab />
      )}
    </AdminRoutePage>
  );
}
