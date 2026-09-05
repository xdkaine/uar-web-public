'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import OffboardCampaignsPanel from '@/components/admin/OffboardCampaignsPanel';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { AdminRoutePage } from '@/components/admin/AdminRoutePage';

interface LDAPUser {
  dn: string;
  username: string;
  displayName: string;
  email: string;
  description: string;
  accountEnabled: boolean;
  accountExpires: string | null;
  whenCreated: string;
  memberOf: string[];
  lastVerifiedAt?: string | null;
  lastVerifiedSource?: string | null;
  originalRegistrationAt?: string | null;
}

export default function AdminOffboardCampaignsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [users, setUsers] = useState<LDAPUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const activeView = searchParams.get('view') === 'dry-run' ? 'dry-run' : 'campaigns';

  const selectView = useCallback((view: 'campaigns' | 'dry-run') => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', view);
    router.replace(`/admin/offboard-campaigns?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  const fetchUsers = useCallback(async () => {
    try {
      setUsersLoading(true);
      const response = await fetch('/api/admin/users');
      if (!response.ok) {
        setUsers([]);
        return;
      }
      const data = await response.json();
      setUsers(data.users || []);
    } catch (error) {
      console.error('Error fetching users:', error);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  return (
    <AdminRoutePage
      title="Offboard Campaigns"
      tabId="offboard-campaigns"
      category="offboard_campaign"
    >
      <AdminPageHeader
        title="Offboard Campaigns"
        description="Run verified offboarding campaigns with rollback safety."
        actions={
          <button
            type="button"
            onClick={fetchUsers}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Refresh accounts
          </button>
        }
      />
      <OffboardCampaignsPanel
        accounts={users}
        accountsLoading={usersLoading}
        activeView={activeView}
        onViewChange={selectView}
      />
    </AdminRoutePage>
  );
}
