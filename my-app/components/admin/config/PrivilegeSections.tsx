'use client';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { describeGroup, formatGroupPath } from '@/lib/support/group-display';
import { AlertTriangle, Loader2, Plus, Save, ShieldCheck, X } from 'lucide-react';
import LdapPathInput from './LdapPathInput';
import type { PrivilegeRow, PrivilegesData } from './PrivilegeSections.shared';

export function PrivilegesOverview({
  data,
  mappedCount,
  filter,
  onFilterChange,
}: {
  data: PrivilegesData | null;
  mappedCount: number;
  filter: string;
  onFilterChange: (filter: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          Privileges &amp; Directory Groups
        </CardTitle>
        <CardDescription>
          Every capability in this application is a privilege, and each privilege is granted by
          membership in the Active Directory groups mapped below. Membership is checked live
          against the directory &mdash; adding a group grants its members the privilege
          immediately; removing it revokes access on their next action. No roles in between.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge variant="secondary">{mappedCount} of {data?.privileges.length ?? 0} privileges mapped</Badge>
          <span>Always-full access (never mapped here): members of the legacy domain-admin groups and break-glass accounts.</span>
        </div>
        {(data?.legacyAdminGroupDns.length ?? 0) > 0 && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">Legacy full-administrator groups</p>
            <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-300/80">
              Members hold every privilege. Configure these in Directory &amp; Email (&ldquo;ldap.adminGroups&rdquo;).
            </p>
            <ul className="mt-1.5 space-y-0.5">
              {data!.legacyAdminGroupDns.map((dn) => {
                const info = describeGroup({ dn });
                return (
                  <li key={dn} className="text-xs text-amber-900 dark:text-amber-200">
                    <span className="font-medium">{info.displayName}</span>
                    {info.path.length > 0 && <span className="text-amber-800/70 dark:text-amber-300/70"> ({formatGroupPath(info.path)})</span>}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        <Input
          type="search"
          placeholder="Filter privileges by name or description…"
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
          className="max-w-sm"
          aria-label="Filter privileges"
        />
      </CardContent>
    </Card>
  );
}

export function OperationalGapsNotice({ gaps }: { gaps: PrivilegesData['operationalGaps'] }) {
  if (gaps.length === 0) return null;

  return (
    <Alert className="border-amber-500/40 bg-amber-500/10 text-amber-900 dark:text-amber-200">
      <AlertTriangle className="h-4 w-4" />
      <AlertDescription>
        <p className="font-semibold">Operational search coverage needs attention</p>
        <p className="mt-1">
          These groups can open Global Search but cannot search every advertised data area. The API remains fail-closed; add the missing privileges or remove
          <span className="mx-1 font-mono text-xs">admin.search</span>
          from the group.
        </p>
        <ul className="mt-2 space-y-1.5">
          {gaps.map((gap) => {
            const group = describeGroup({ dn: gap.groupDn });
            return <li key={gap.groupDn}><span className="font-medium">{group.displayName}</span><span>: missing </span><span className="font-mono text-xs">{gap.missingPermissions.join(', ')}</span></li>;
          })}
        </ul>
      </AlertDescription>
    </Alert>
  );
}

function PrivilegeMappingCard({
  privilege,
  dns,
  newDn,
  saving,
  onNewDnChange,
  onAdd,
  onRemove,
  onSave,
}: {
  privilege: PrivilegeRow;
  dns: string[];
  newDn: string;
  saving: boolean;
  onNewDnChange: (value: string) => void;
  onAdd: () => void;
  onRemove: (dn: string) => void;
  onSave: () => void;
}) {
  const dirty = JSON.stringify(dns) !== JSON.stringify(privilege.adGroupDns);
  return (
    <div className="rounded-lg border p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{privilege.description}</span>
        <Badge variant="outline" className="font-mono text-xs">{privilege.permissionKey}</Badge>
        {privilege.adGroupDns.length === 0 && <Badge variant="outline" className="text-muted-foreground">no groups mapped</Badge>}
      </div>
      <div className="space-y-1.5">
        <Label>Granted by membership in</Label>
        {dns.length === 0 ? (
          <p className="text-sm text-muted-foreground">No directory groups grant this privilege yet.</p>
        ) : (
          <ul className="space-y-1">
            {dns.map((dn) => {
              const info = describeGroup({ dn });
              return (
                <li key={dn} className="flex items-center justify-between gap-2 rounded border bg-muted/30 px-2 py-1">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium">{info.displayName}</span>
                    {info.path.length > 0 && <span className="block truncate text-xs text-muted-foreground">{formatGroupPath(info.path)}</span>}
                  </span>
                  <span className="flex shrink-0 items-center gap-1">
                    <span className="hidden font-mono text-xs text-muted-foreground sm:block" title={dn}>DN</span>
                    <button type="button" aria-label={`Remove ${info.displayName}`} className="rounded p-0.5 hover:bg-accent" onClick={() => onRemove(dn)}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex items-end gap-2 pt-1">
          <div className="flex-1">
            <LdapPathInput
              id={`dns-${privilege.permissionKey}`}
              suggestType="group"
              placeholder="CN=UAR-Faculty,OU=Groups,DC=example,DC=edu"
              value={newDn}
              onChange={onNewDnChange}
            />
          </div>
          <Button size="sm" variant="outline" disabled={!newDn.trim()} onClick={onAdd}>
            <Plus className="h-4 w-4 mr-2" />
            Add
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between">
        {privilege.updatedBy && privilege.updatedAt ? <span className="text-xs text-muted-foreground">Last updated by {privilege.updatedBy}</span> : <span />}
        <Button size="sm" disabled={!dirty || saving} onClick={onSave}>
          {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
          Save Mapping
        </Button>
      </div>
    </div>
  );
}

export function PrivilegeAreaSections({
  grouped,
  drafts,
  newDnDrafts,
  savingKey,
  onNewDnChange,
  onAdd,
  onRemove,
  onSave,
}: {
  grouped: Map<string, PrivilegeRow[]>;
  drafts: Record<string, string[]>;
  newDnDrafts: Record<string, string>;
  savingKey: string | null;
  onNewDnChange: (permissionKey: string, value: string) => void;
  onAdd: (permissionKey: string) => void;
  onRemove: (permissionKey: string, dn: string) => void;
  onSave: (permissionKey: string) => void;
}) {
  return [...grouped.entries()].map(([area, privileges]) => (
    <Card key={area}>
      <CardHeader><CardTitle className="text-base">{area}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {privileges.map((privilege) => (
          <PrivilegeMappingCard
            key={privilege.permissionKey}
            privilege={privilege}
            dns={drafts[privilege.permissionKey] ?? []}
            newDn={newDnDrafts[privilege.permissionKey] ?? ''}
            saving={savingKey === privilege.permissionKey}
            onNewDnChange={(value) => onNewDnChange(privilege.permissionKey, value)}
            onAdd={() => onAdd(privilege.permissionKey)}
            onRemove={(dn) => onRemove(privilege.permissionKey, dn)}
            onSave={() => onSave(privilege.permissionKey)}
          />
        ))}
      </CardContent>
    </Card>
  ));
}
