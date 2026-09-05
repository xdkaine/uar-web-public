'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { fetchWithCsrf } from '@/lib/csrf';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2 } from 'lucide-react';
import {
  OperationalGapsNotice,
  PrivilegeAreaSections,
  PrivilegesOverview,
} from './PrivilegeSections';
import { groupPrivileges, type PrivilegesData } from './PrivilegeSections.shared';

export default function PrivilegesPanel() {
  const [data, setData] = useState<PrivilegesData | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string[]>>({});
  const [newDnDrafts, setNewDnDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchPrivileges = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/config/privileges');
      if (!response.ok) throw new Error('Failed to load privileges');
      const result: PrivilegesData = await response.json();
      setData(result);
      setDrafts(
        Object.fromEntries(
          result.privileges.map((privilege) => [privilege.permissionKey, [...privilege.adGroupDns]])
        )
      );
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrivileges();
  }, [fetchPrivileges]);

  const savePrivilege = async (permissionKey: string) => {
    setSavingKey(permissionKey);
    setMessage(null);
    try {
      const response = await fetchWithCsrf('/api/admin/config/privileges', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionKey, adGroupDns: drafts[permissionKey] ?? [] }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to save privilege mapping');
      setMessage({ type: 'success', text: `Saved mapping for "${permissionKey}".` });
      await fetchPrivileges();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to save' });
    } finally {
      setSavingKey(null);
    }
  };

  const addGroup = (permissionKey: string) => {
    const dn = (newDnDrafts[permissionKey] ?? '').trim();
    if (!dn) return;
    setDrafts((prev) => {
      const current = prev[permissionKey] ?? [];
      if (current.some((existing) => existing.toLowerCase() === dn.toLowerCase())) return prev;
      return { ...prev, [permissionKey]: [...current, dn] };
    });
    setNewDnDrafts((prev) => ({ ...prev, [permissionKey]: '' }));
  };

  const removeGroup = (permissionKey: string, dn: string) => {
    setDrafts((prev) => ({
      ...prev,
      [permissionKey]: (prev[permissionKey] ?? []).filter((existing) => existing !== dn),
    }));
  };

  const grouped = useMemo(
    () => groupPrivileges(data?.privileges ?? [], filter),
    [data, filter]
  );

  const mappedCount = useMemo(
    () => (data?.privileges ?? []).filter((privilege) => (drafts[privilege.permissionKey] ?? []).length > 0).length,
    [data, drafts]
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {message && (
        <Alert variant={message.type === 'error' ? 'destructive' : 'default'}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}

      <PrivilegesOverview
        data={data}
        mappedCount={mappedCount}
        filter={filter}
        onFilterChange={setFilter}
      />
      <OperationalGapsNotice gaps={data?.operationalGaps ?? []} />
      <PrivilegeAreaSections
        grouped={grouped}
        drafts={drafts}
        newDnDrafts={newDnDrafts}
        savingKey={savingKey}
        onNewDnChange={(permissionKey, value) =>
          setNewDnDrafts((previous) => ({ ...previous, [permissionKey]: value }))
        }
        onAdd={addGroup}
        onRemove={removeGroup}
        onSave={savePrivilege}
      />
    </div>
  );
}
