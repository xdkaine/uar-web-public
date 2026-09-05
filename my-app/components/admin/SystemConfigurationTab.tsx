'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import SystemSettingsTab from './SystemSettingsTab';
import ModulesPanel from './config/ModulesPanel';
import GovernancePanel from './config/GovernancePanel';
import MessagesPanel from './config/MessagesPanel';
import PrivilegesPanel from './config/PrivilegesPanel';
import DirectoryEmailPanel from './config/DirectoryEmailPanel';
import TicketRoutingPanel from './config/TicketRoutingPanel';
import LocalAccountsPanel from './config/LocalAccountsPanel';
import AppearancePanel from './config/AppearancePanel';
import SignInPanel from './config/SignInPanel';
import { getVisibleAdminConfigurationSections, type AdminConfigurationSectionId } from '@/lib/admin/navigation';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface SystemConfigurationTabProps { isLoading: boolean; onRefresh: () => void; }

function isConfigurationSectionId(value: string | null): value is AdminConfigurationSectionId {
  return value !== null && ['general', 'sign-in', 'directory', 'modules', 'requests', 'messages', 'roles', 'support', 'break-glass', 'appearance'].includes(value);
}

export default function SystemConfigurationTab({ isLoading, onRefresh }: SystemConfigurationTabProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedSection = searchParams.get('section');
  const [permissions, setPermissions] = useState<Set<string> | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve()
      .then(() => {
        if (!cancelled) {
          setLoadError(null);
          setPermissions(null);
        }
        return fetch('/api/auth/session', { cache: 'no-store' });
      })
      .then(async (response) => {
        if (!response.ok) throw new Error('Unable to load configuration access.');
        const data = await response.json() as { permissions?: unknown };
        if (!Array.isArray(data.permissions)) throw new Error('Configuration access was incomplete.');
        return new Set(data.permissions.filter((permission): permission is string => typeof permission === 'string'));
      })
      .then((nextPermissions) => { if (!cancelled) setPermissions(nextPermissions); })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Unable to load configuration access.');
      });
    return () => { cancelled = true; };
  }, [reloadToken]);

  const sections = useMemo(() => permissions ? getVisibleAdminConfigurationSections(permissions) : [], [permissions]);
  const selectedSection = isConfigurationSectionId(requestedSection) ? requestedSection : sections[0]?.id;
  const requestedSectionForbidden = requestedSection !== null
    && (!isConfigurationSectionId(requestedSection) || !sections.some((section) => section.id === requestedSection));
  const selectSection = useCallback((section: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('section', section);
    router.replace(`/admin/settings?${params.toString()}`, { scroll: false });
  }, [router, searchParams]);

  if (loadError) return <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm"><p className="font-medium text-foreground">Configuration access is unavailable</p><p className="mt-1 text-muted-foreground">{loadError}</p><Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => setReloadToken((token) => token + 1)}>Try again</Button></div>;
  if (!permissions) return <p aria-busy="true" className="text-sm text-muted-foreground">Loading available configuration sections…</p>;
  if (requestedSectionForbidden || !selectedSection) return <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm"><p className="font-medium text-foreground">You do not have access to this configuration section.</p><p className="mt-1 text-muted-foreground">Choose a section available to your assigned privileges.</p></div>;

  return <Tabs value={selectedSection} onValueChange={selectSection} className="space-y-4">
    <TabsList aria-label="System configuration sections" className="h-auto w-full justify-start gap-1 overflow-x-auto p-1">
      {sections.map((entry) => <TabsTrigger key={entry.id} value={entry.id} className="shrink-0">{entry.label}</TabsTrigger>)}
    </TabsList>
    <TabsContent value="general"><SystemSettingsTab isLoading={isLoading} onRefresh={onRefresh} /></TabsContent>
    <TabsContent value="sign-in"><SignInPanel /></TabsContent>
    <TabsContent value="directory"><DirectoryEmailPanel /></TabsContent>
    <TabsContent value="modules"><ModulesPanel /></TabsContent>
    <TabsContent value="requests"><GovernancePanel /></TabsContent>
    <TabsContent value="messages"><MessagesPanel /></TabsContent>
    <TabsContent value="roles"><PrivilegesPanel /></TabsContent>
    <TabsContent value="support"><TicketRoutingPanel /></TabsContent>
    <TabsContent value="break-glass"><LocalAccountsPanel /></TabsContent>
    <TabsContent value="appearance"><AppearancePanel /></TabsContent>
  </Tabs>;
}
