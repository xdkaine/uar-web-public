'use client';

import UserManagementTab from '@/components/admin/UserManagementTab';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { AdminRoutePage } from '@/components/admin/AdminRoutePage';

export default function AdminUsersPage() {
  return (
    <AdminRoutePage title="Directory Users" tabId="users" category="user">
      <AdminPageHeader
        title="Directory Users"
        description="Browse, inspect, and manage Active Directory accounts."
      />
      <UserManagementTab />
    </AdminRoutePage>
  );
}
