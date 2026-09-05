'use client';

import PasswordExpirationTab from '@/components/admin/PasswordExpirationTab';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { AdminRoutePage } from '@/components/admin/AdminRoutePage';

export default function AdminPasswordExpirationPage() {
  return (
    <AdminRoutePage
      title="Password Expiration"
      tabId="password-expiration"
      category="user"
    >
      <AdminPageHeader
        title="Password Expiration"
        description="Directory password expiry outlook and reminder history."
      />
      <PasswordExpirationTab />
    </AdminRoutePage>
  );
}
