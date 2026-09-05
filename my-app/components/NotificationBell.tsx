'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import useSWR from 'swr';
import { Bell, CheckCheck, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { ClientLocalDate } from '@/components/admin/ClientLocalDate';
import { fetchWithCsrf } from '@/lib/csrf';
import { fetchJson } from '@/lib/client-query';

interface NotificationItem {
  id: string;
  createdAt: string;
  title: string;
  message: string;
  severity: string;
  href: string | null;
  readAt: string | null;
}

interface NotificationPreferences {
  accessRequests: boolean;
  supportTickets: boolean;
  syncFailures: boolean;
}

export default function NotificationBell({ enabled = true }: { enabled?: boolean }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    accessRequests: true,
    supportTickets: true,
    syncFailures: true,
  });

  const load = useCallback(async () => {
    if (!enabled) return;
    try {
      const response = await fetch('/api/notifications');
      if (!response.ok) throw new Error('Notifications are unavailable');
      const body = await response.json();
      setItems(body.items ?? []);
      setUnread(body.unread ?? 0);
      setLoadState('ready');
      setError('');
    } catch (loadError) {
      setLoadState('error');
      setError(loadError instanceof Error ? loadError.message : 'Notifications are unavailable');
    }
  }, [enabled]);
  useSWR<{ items?: NotificationItem[]; unread?: number }>(
    enabled ? '/api/notifications' : null,
    fetchJson,
    {
      refreshInterval: 60_000,
      onSuccess: (body) => {
        setItems(body.items ?? []);
        setUnread(body.unread ?? 0);
        setLoadState('ready');
        setError('');
      },
      onError: () => {
        setLoadState('error');
        setError('Notifications are unavailable');
      },
    }
  );
  useSWR<{ preferences?: NotificationPreferences }>(
    enabled && open ? '/api/notifications/preferences' : null,
    fetchJson,
    {
      onSuccess: (body) => body.preferences && setPreferences(body.preferences),
      onError: () => setError('Notification preferences are unavailable'),
    }
  );

  const mutate = async (id: string | null, action: 'read' | 'dismiss' | 'read_all') => {
    setPending(`${action}:${id ?? 'all'}`);
    try {
      const response = await fetchWithCsrf('/api/notifications', {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id, action }),
      });
      if (!response.ok) throw new Error('Notification update failed');
      await load();
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : 'Notification update failed');
    } finally {
      setPending(null);
    }
  };

  const updatePreference = async (key: keyof NotificationPreferences, checked: boolean) => {
    const next = { ...preferences, [key]: checked };
    setPreferences(next);
    setPending(`preference:${key}`);
    try {
      const response = await fetchWithCsrf('/api/notifications/preferences', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error('Preference update failed');
    } catch {
      setPreferences(preferences);
      setError('Preference update failed');
    } finally {
      setPending(null);
    }
  };

  if (!enabled) return null;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative text-white hover:bg-white/10 hover:text-white" aria-label={`${unread} unread notifications`}>
          <Bell className="h-5 w-5" />
          {unread > 0 && <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,390px)] p-0">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div><p className="font-semibold">Notifications</p><p className="text-xs text-muted-foreground">Account-specific alerts</p></div>
          {unread > 0 && <Button variant="ghost" size="sm" disabled={pending !== null} onClick={() => mutate(null, 'read_all')}><CheckCheck className="h-4 w-4" /> Read all</Button>}
        </div>
        {error && <div role="alert" className="border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">{error} <button type="button" className="font-medium underline" onClick={() => void load()}>Retry</button></div>}
        <div className="max-h-[420px] overflow-y-auto">
          {loadState === 'loading' && <p className="px-4 py-10 text-center text-sm text-muted-foreground">Loading notifications…</p>}
          {items.map((item) => (
            <div key={item.id} className={`group relative border-b px-4 py-3 ${item.readAt ? '' : 'bg-primary/5'}`}>
              <div className="flex gap-3">
                <span className={`mt-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${item.severity === 'critical' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200' : item.severity === 'warning' ? 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' : 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200'}`}>{item.severity}</span>
                <div className="min-w-0 flex-1">
                  {item.href ? <Link href={item.href} onClick={() => { void mutate(item.id, 'read'); setOpen(false); }} className="text-sm font-medium hover:underline">{item.title}</Link> : <p className="text-sm font-medium">{item.title}</p>}
                  <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{item.message}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground"><ClientLocalDate value={item.createdAt} /></p>
                </div>
                <button type="button" disabled={pending !== null} onClick={() => mutate(item.id, 'dismiss')} className="opacity-60 hover:opacity-100 disabled:opacity-30" aria-label={`Dismiss ${item.title}`}><X className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
          {loadState === 'ready' && items.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">No notifications.</p>}
        </div>
        <div className="border-t bg-muted/30 px-4 py-3">
          <button type="button" onClick={() => setShowPreferences((value) => !value)} className="text-xs font-medium text-muted-foreground hover:text-foreground">
            {showPreferences ? 'Hide notification preferences' : 'Notification preferences'}
          </button>
          {showPreferences && (
            <div className="mt-3 space-y-3">
              {([
                ['accessRequests', 'Access requests'],
                ['supportTickets', 'Support tickets'],
                ['syncFailures', 'Sync and service failures'],
              ] as const).map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-4 text-xs">
                  <span>{label}</span>
                  <Switch checked={preferences[key]} disabled={pending !== null} onCheckedChange={(checked) => void updatePreference(key, checked)} aria-label={label} />
                </label>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
