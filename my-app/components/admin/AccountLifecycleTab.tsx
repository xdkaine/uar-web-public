'use client';

import { useCallback, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Activity, ShieldCheck, Users } from 'lucide-react';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAdminNavigation } from '@/components/admin/AdminShell';
import LifecycleAccountsWorkspace from '@/components/admin/lifecycle/LifecycleAccountsWorkspace';
import LifecycleGroupsWorkspace from '@/components/admin/lifecycle/LifecycleGroupsWorkspace';
import LifecycleOperationsPanel from '@/components/admin/lifecycle/LifecycleOperationsPanel';

export default function AccountLifecycleTab() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const navigation = useAdminNavigation();
  const [refreshVersion, setRefreshVersion] = useState(0);
  const permissions = navigation?.permissions ?? new Set<string>();
  const canReadGroups = permissions.has('users.read');
  const requestedView = searchParams.get('view');
  const selectedView = requestedView === 'operations'
    ? 'operations'
    : requestedView === 'groups' && canReadGroups
      ? 'groups'
      : 'accounts';
  const selectView = useCallback((view: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('view', view);
    router.replace(`/admin/lifecycle?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  if (!navigation || navigation.state === 'loading') {
    return <p aria-busy="true" className="py-10 text-sm text-muted-foreground">Loading lifecycle privileges…</p>;
  }

  if (navigation.state === 'error') {
    return (
      <Alert variant="destructive">
        <AlertTitle>Lifecycle privileges are unavailable</AlertTitle>
        <AlertDescription>{navigation.error || 'Reload the admin navigation before using lifecycle operations.'}</AlertDescription>
      </Alert>
    );
  }

  return (
    <Tabs value={selectedView} onValueChange={selectView} className="gap-5">
      <div className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-medium text-foreground">Account Lifecycle Actions</p>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Select accounts, preview affected systems, and retain one recoverable operation record per target.
          </p>
        </div>
        <TabsList className="grid h-10 w-full grid-cols-3 sm:w-auto">
          <TabsTrigger value="accounts"><ShieldCheck /> Accounts</TabsTrigger>
          <TabsTrigger value="groups" disabled={!canReadGroups}><Users /> Groups</TabsTrigger>
          <TabsTrigger value="operations"><Activity /> Operations</TabsTrigger>
        </TabsList>
      </div>

      <TabsContent id="lifecycle-accounts" value="accounts" className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <LifecycleAccountsWorkspace
          permissions={permissions}
          onOperationsChanged={() => setRefreshVersion((version) => version + 1)}
        />
      </TabsContent>
      <TabsContent id="lifecycle-groups" value="groups" forceMount className="scroll-mt-20 data-[state=inactive]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <LifecycleGroupsWorkspace
          active={selectedView === 'groups'}
          permissions={permissions}
          onOperationsChanged={() => setRefreshVersion((version) => version + 1)}
        />
      </TabsContent>
      <TabsContent id="lifecycle-operations" value="operations" className="scroll-mt-20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <LifecycleOperationsPanel refreshVersion={refreshVersion} />
      </TabsContent>
    </Tabs>
  );
}
