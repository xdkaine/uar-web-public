'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchWithCsrf } from '@/lib/csrf';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Puzzle } from 'lucide-react';
import ModuleCards, { type ModuleInfo, type ModuleUsageInfo } from './ModuleCards';

export default function ModulesPanel() {
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [usage, setUsage] = useState<Record<string, ModuleUsageInfo>>({});
  const [loading, setLoading] = useState(true);
  const [savingModule, setSavingModule] = useState<string | null>(null);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchModules = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/modules');
      if (!response.ok) throw new Error('Failed to fetch modules');
      const data = await response.json();
      setModules(data.modules || []);
    } catch {
      setMessage({ type: 'error', text: 'Failed to load module states' });
    } finally {
      setLoading(false);
    }
  }, []);

  // Usage evidence is best-effort: without modules.manage the endpoint 403s
  // and the panel falls back to static registry counts.
  const fetchUsage = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/modules/usage');
      if (!response.ok) return;
      const data = await response.json();
      const byId: Record<string, ModuleUsageInfo> = {};
      for (const entry of data.modules || []) {
        byId[entry.moduleId] = entry;
      }
      setUsage(byId);
    } catch {
      // Advisory payload only; the panel renders without live counts.
    }
  }, []);

  useEffect(() => {
    fetchModules();
    fetchUsage();
  }, [fetchModules, fetchUsage]);

  const toggleModule = async (moduleId: string, enabled: boolean) => {
    setSavingModule(moduleId);
    setMessage(null);
    try {
      const response = await fetchWithCsrf('/api/admin/modules', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ moduleId, enabled }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to update module');
      }
      await Promise.all([fetchModules(), fetchUsage()]);
      setMessage({
        type: 'success',
        text: `${enabled ? 'Enabled' : 'Disabled'} ${moduleId}.`,
      });
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to update module' });
    } finally {
      setSavingModule(null);
    }
  };

  const toggleExpanded = (moduleId: string) => {
    setExpandedModules((previous) => {
      const next = new Set(previous);
      if (next.has(moduleId)) {
        next.delete(moduleId);
      } else {
        next.add(moduleId);
      }
      return next;
    });
  };

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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Puzzle className="h-5 w-5" />
            Capability Modules
          </CardTitle>
          <CardDescription>
            Optional capabilities can be disabled without deleting their data. Each card shows what
            the module powers right now - admin tabs, workflows, rules, and scheduled jobs - so you
            can see what stops before toggling.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <ModuleCards
            modules={modules}
            usage={usage}
            savingModule={savingModule}
            expandedModules={expandedModules}
            onToggle={toggleModule}
            onToggleExpanded={toggleExpanded}
          />
        </CardContent>
      </Card>
    </div>
  );
}
