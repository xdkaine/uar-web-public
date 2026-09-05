'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchWithCsrf } from '@/lib/csrf';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, Save, GitBranch, History } from 'lucide-react';
import EmailListInput from './EmailListInput';

interface WorkflowStage {
  key: string;
  label: string;
  reviewerRoleKey: string;
  notifyEmails?: string[] | null;
}

interface CatalogEntry {
  key: string;
  status: string;
  defaultLabel: string;
}

interface WorkflowData {
  workflow: { id: string | null; version: number; stages: WorkflowStage[] };
  history: Array<{ id: string; version: number; status: string; createdBy: string | null; createdAt: string; stages: unknown }>;
  catalog: { stages: CatalogEntry[]; reviewerRoles: string[] };
}

export default function GovernancePanel() {
  const [data, setData] = useState<WorkflowData | null>(null);
  const [stages, setStages] = useState<WorkflowStage[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchWorkflow = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/config/workflow');
      if (!response.ok) throw new Error('Failed to load governance configuration');
      const result = await response.json();
      setData(result);
      setStages(result.workflow.stages);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWorkflow();
  }, [fetchWorkflow]);

  const catalogByKey = new Map((data?.catalog.stages ?? []).map((entry) => [entry.key, entry]));
  const availableKeys = (data?.catalog.stages ?? []).map((entry) => entry.key);

  const toggleStage = (key: string, include: boolean) => {
    if (include) {
      const entry = catalogByKey.get(key)!;
      setStages((prev) => [...prev, { key, label: entry.defaultLabel, reviewerRoleKey: key === 'faculty' ? 'faculty' : 'director', notifyEmails: null }]);
      // Keep catalog order stable.
      setStages((prev) => availableKeys.filter((k) => prev.some((s) => s.key === k)).map((k) => prev.find((s) => s.key === k)!));
    } else {
      setStages((prev) => prev.filter((stage) => stage.key !== key));
    }
  };

  const updateStage = (key: string, patch: Partial<WorkflowStage>) => {
    setStages((prev) => prev.map((stage) => (stage.key === key ? { ...stage, ...patch } : stage)));
  };

  const publish = async () => {
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetchWithCsrf('/api/admin/config/workflow', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stages }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Failed to publish workflow');
      setMessage({ type: 'success', text: `Published workflow v${result.workflow.version}. New requests use it immediately; in-flight requests keep their pinned version.` });
      await fetchWorkflow();
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to publish' });
    } finally {
      setSaving(false);
    }
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
            <GitBranch className="h-5 w-5" />
            Access Request Review Workflow
          </CardTitle>
          <CardDescription>
            Define which review stages a request passes through and who reviews each stage. Publishing creates
            a new immutable version; requests already in flight stay on the version they were submitted under.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border p-3 text-sm">
            Active version:{' '}
            <Badge variant={data?.workflow.id ? 'default' : 'secondary'}>
              {data?.workflow.id ? `v${data?.workflow.version} (configured)` : 'built-in default'}
            </Badge>
          </div>

          {(data?.catalog.stages ?? []).map((entry) => {
            const stage = stages.find((s) => s.key === entry.key);
            const included = !!stage;
            return (
              <div key={entry.key} className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="font-medium">{entry.defaultLabel}</span>
                    <p className="text-xs text-muted-foreground font-mono">{entry.status}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">{included ? 'Required' : 'Skipped'}</span>
                    <Switch
                      checked={included}
                      onCheckedChange={(checked) => toggleStage(entry.key, checked)}
                      disabled={!included && stages.length >= availableKeys.length}
                    />
                  </div>
                </div>
                {included && stage && (
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor={`label-${entry.key}`}>Display name</Label>
                      <Input
                        id={`label-${entry.key}`}
                        value={stage.label}
                        maxLength={80}
                        onChange={(e) => updateStage(entry.key, { label: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor={`role-${entry.key}`}>Reviewer role</Label>
                      <select
                        id={`role-${entry.key}`}
                        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                        value={stage.reviewerRoleKey}
                        onChange={(e) => updateStage(entry.key, { reviewerRoleKey: e.target.value })}
                      >
                        {(data?.catalog.reviewerRoles ?? []).map((role) => (
                          <option key={role} value={role}>{role}</option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5 md:col-span-2">
                      <Label htmlFor={`notify-${entry.key}`}>
                        Stage notification recipients (optional; empty uses the default email settings)
                      </Label>
                      <EmailListInput
                        id={`notify-${entry.key}`}
                        placeholder="chair@example.edu"
                        value={(stage.notifyEmails ?? []).join(',')}
                        onChange={(value) =>
                          updateStage(entry.key, {
                            notifyEmails: value
                              .split(',')
                              .map((v) => v.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <Button onClick={publish} disabled={saving || stages.length === 0}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Publish New Version
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <History className="h-4 w-4" />
            Published Versions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {(data?.history ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No configured versions yet; the built-in default applies.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(data?.history ?? []).map((entry) => (
                <li key={entry.id} className="flex items-center justify-between rounded border px-3 py-2">
                  <span>v{entry.version}</span>
                  <span className="text-muted-foreground">
                    by {entry.createdBy ?? 'unknown'} at {new Date(entry.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
