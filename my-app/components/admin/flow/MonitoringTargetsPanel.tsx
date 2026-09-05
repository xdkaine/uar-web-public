'use client';

import { useCallback, useEffect, useState } from 'react';
import { Activity, Loader2, Pause, Play, Plus, Server, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { fetchWithCsrf } from '@/lib/csrf';
import { ClientLocalDate } from '@/components/admin/ClientLocalDate';

interface Target {
  id: string;
  name: string;
  preset: string;
  protocol: string;
  host: string;
  port: number;
  path: string | null;
  currentState: string;
  enabled: boolean;
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  timeoutMs: number;
  failureThreshold: number;
  recoveryThreshold: number;
  updatedAt: string;
  configVersion: number;
}

const PRESETS: Record<string, { port: string; path: string }> = {
  proxmox: { port: '8006', path: '/api2/json/version' },
  truenas: { port: '443', path: '/api/v2.0/system/state' },
  generic_https: { port: '443', path: '/' },
  tcp: { port: '443', path: '' },
};

export default function MonitoringTargetsPanel() {
  const [targets, setTargets] = useState<Target[]>([]);
  const [draft, setDraft] = useState({ name: '', preset: 'proxmox', host: '', port: '8006', path: '/api2/json/version' });
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [targetToRemove, setTargetToRemove] = useState<Target | null>(null);

  const load = useCallback(async () => {
    try {
      setLoadState('loading');
      const response = await fetch('/api/admin/monitoring-targets');
      if (!response.ok) throw new Error('Monitoring targets are unavailable');
      setTargets((await response.json()).targets ?? []);
      setLoadState('ready');
    } catch {
      setLoadState('error');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const payload = () => ({
    ...draft,
    port: Number(draft.port),
    timeoutMs: 5000,
    failureThreshold: 2,
    recoveryThreshold: 2,
    enabled: true,
  });

  const changePreset = (preset: string) => {
    const defaults = PRESETS[preset]!;
    setDraft((current) => ({ ...current, preset, ...defaults }));
  };

  const test = async () => {
    setBusy('test'); setMessage(null);
    try {
      const response = await fetchWithCsrf('/api/admin/monitoring-targets/test', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload()),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Probe failed');
      setMessage({ ok: body.result.reachable, text: body.result.reachable ? `Online · ${body.result.latencyMs} ms` : `Offline · ${body.result.error || 'probe failed'}` });
    } catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : 'Probe failed' }); }
    finally { setBusy(null); }
  };

  const add = async () => {
    setBusy('add'); setMessage(null);
    try {
      const response = await fetchWithCsrf('/api/admin/monitoring-targets', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload()),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not add target');
      setDraft({ name: '', preset: 'proxmox', host: '', port: '8006', path: '/api2/json/version' });
      await load();
    } catch (error) { setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not add target' }); }
    finally { setBusy(null); }
  };

  const remove = async (id: string) => {
    setBusy(id);
    try {
      const target = targets.find((item) => item.id === id);
      const response = await fetchWithCsrf(
        `/api/admin/monitoring-targets?id=${encodeURIComponent(id)}&expectedConfigVersion=${encodeURIComponent(String(target?.configVersion ?? ''))}`,
        { method: 'DELETE' }
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not remove target');
      await load();
      setTargetToRemove(null);
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not remove target' });
    } finally { setBusy(null); }
  };

  const updateTarget = async (target: Target, changes: Partial<Target>) => {
    setBusy(target.id);
    setMessage(null);
    try {
      const response = await fetchWithCsrf('/api/admin/monitoring-targets', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: target.id,
          name: target.name,
          preset: target.preset,
          protocol: target.protocol,
          host: target.host,
          port: target.port,
          path: target.path ?? '',
          timeoutMs: target.timeoutMs,
          failureThreshold: target.failureThreshold,
          recoveryThreshold: target.recoveryThreshold,
          enabled: target.enabled,
          expectedConfigVersion: target.configVersion,
          ...changes,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Could not update target');
      await load();
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Could not update target' });
    } finally {
      setBusy(null);
    }
  };

  const testSaved = async (target: Target) => {
    setBusy(`test-${target.id}`);
    setMessage(null);
    try {
      const response = await fetchWithCsrf('/api/admin/monitoring-targets/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(target),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Probe failed');
      setMessage({
        ok: body.result.reachable,
        text: `${target.name}: ${body.result.reachable ? `online · ${body.result.latencyMs} ms` : `offline · ${body.result.error || 'probe failed'}`}`,
      });
    } catch (error) {
      setMessage({ ok: false, text: error instanceof Error ? error.message : 'Probe failed' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card className="mb-6 overflow-hidden">
      <CardHeader className="border-b bg-muted/25">
        <CardTitle className="flex items-center gap-2"><Activity className="h-5 w-5" /> Monitored endpoints</CardTitle>
        <CardDescription>
          Register bounded HTTPS or TCP checks for Proxmox, TrueNAS, VMs, and services. Checks verify TLS, never follow redirects, send no credentials, and emit failure/recovery triggers only after two consecutive results.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 pt-5">
        <div className="grid gap-3 rounded-lg border bg-background p-4 md:grid-cols-2 xl:grid-cols-[1fr_180px_1fr_110px_1fr_auto] xl:items-end">
          <div className="space-y-1.5"><Label>Name</Label><Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Proxmox cluster" /></div>
          <div className="space-y-1.5"><Label>Check type</Label><Select value={draft.preset} onValueChange={changePreset}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="proxmox">Proxmox</SelectItem><SelectItem value="truenas">TrueNAS</SelectItem><SelectItem value="generic_https">HTTPS</SelectItem><SelectItem value="tcp">TCP port</SelectItem></SelectContent></Select></div>
          <div className="space-y-1.5"><Label>Host</Label><Input value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} placeholder="10.0.0.20 or host.example.edu" /></div>
          <div className="space-y-1.5"><Label>Port</Label><Input inputMode="numeric" value={draft.port} onChange={(e) => setDraft({ ...draft, port: e.target.value })} /></div>
          <div className="space-y-1.5"><Label>HTTPS path</Label><Input disabled={draft.preset !== 'generic_https'} value={draft.path} onChange={(e) => setDraft({ ...draft, path: e.target.value })} /></div>
          <div className="flex gap-2"><Button type="button" variant="outline" onClick={test} disabled={!!busy || !draft.name || !draft.host}>{busy === 'test' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Test</Button><Button type="button" onClick={add} disabled={!!busy || !draft.name || !draft.host}><Plus className="h-4 w-4" /> Add</Button></div>
        </div>
        {message && <Alert variant={message.ok ? 'default' : 'destructive'}><AlertDescription>{message.text}</AlertDescription></Alert>}
        {loadState === 'error' && (
          <Alert variant="destructive"><AlertDescription className="flex items-center justify-between gap-3">Monitoring targets could not be loaded.<Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button></AlertDescription></Alert>
        )}
        <div className="grid gap-3 lg:grid-cols-2">
          {loadState === 'loading' && <p className="text-sm text-muted-foreground lg:col-span-2">Loading monitoring targets…</p>}
          {targets.map((target) => (
            <div key={target.id} className="flex items-start gap-3 rounded-lg border p-3">
              <span className="rounded-md border bg-muted/30 p-2"><Server className="h-4 w-4" /></span>
              <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-medium">{target.name}</p><Badge variant={target.currentState === 'down' ? 'destructive' : target.currentState === 'up' ? 'default' : 'secondary'}>{target.currentState}</Badge><Badge variant="outline">{target.protocol.toUpperCase()}</Badge>{!target.enabled && <Badge variant="outline">disabled</Badge>}</div><p className="mt-1 truncate font-mono text-xs text-muted-foreground">{target.host}:{target.port}{target.path}</p><p className="mt-1 text-xs text-muted-foreground">{target.lastCheckedAt ? <>Checked <ClientLocalDate value={target.lastCheckedAt} />{target.lastLatencyMs !== null ? ` · ${target.lastLatencyMs} ms` : ''}</> : 'Not checked yet'}{target.lastError ? ` · ${target.lastError}` : ''}</p><p className="mt-1 text-xs text-muted-foreground">{target.timeoutMs} ms timeout · down after {target.failureThreshold} · recover after {target.recoveryThreshold}</p></div>
              <div className="flex shrink-0 gap-1">
                <Button type="button" variant="ghost" size="sm" onClick={() => void testSaved(target)} disabled={!!busy} aria-label={`Test ${target.name}`}>{busy === `test-${target.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => void updateTarget(target, { enabled: !target.enabled })} disabled={!!busy} aria-label={`${target.enabled ? 'Disable' : 'Enable'} ${target.name}`}>{target.enabled ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setTargetToRemove(target)} disabled={!!busy} aria-label={`Remove ${target.name}`}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </div>
          ))}
          {loadState === 'ready' && targets.length === 0 && <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground lg:col-span-2">No endpoints registered. Add one above, test it, then use the failure/recovery triggers in a workflow.</p>}
        </div>
        <AlertDialog open={targetToRemove !== null} onOpenChange={(open) => !open && setTargetToRemove(null)}>
          <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Remove monitoring target?</AlertDialogTitle><AlertDialogDescription>{targetToRemove?.name} will stop producing availability evidence and workflow triggers. Existing history remains.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep target</AlertDialogCancel><AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => targetToRemove && void remove(targetToRemove.id)}>Remove target</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
