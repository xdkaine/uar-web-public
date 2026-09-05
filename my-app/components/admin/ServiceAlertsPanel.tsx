'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchWithCsrf } from '@/lib/csrf';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw } from 'lucide-react';

interface ServiceAlert {
  id: string;
  dedupeKey: string;
  category: string;
  severity: string;
  title: string;
  message: string;
  source: string;
  status: string;
  occurrenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
  dismissedBy: string | null;
}

const STATUS_FILTERS = ['all', 'active', 'resolved', 'dismissed'] as const;

function severityVariant(severity: string): 'default' | 'destructive' | 'secondary' {
  if (severity === 'critical') return 'destructive';
  if (severity === 'warning') return 'default';
  return 'secondary';
}

export default function ServiceAlertsPanel() {
  const [alerts, setAlerts] = useState<ServiceAlert[]>([]);
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>('all');
  const [loading, setLoading] = useState(true);
  const [dismissingId, setDismissingId] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchAlerts = useCallback(async (filter: string) => {
    setLoading(true);
    try {
      const query = filter === 'all' ? '' : `?status=${filter}`;
      const response = await fetch(`/api/admin/service-alerts${query}`);
      if (!response.ok) throw new Error('Failed to load service alerts');
      const data = await response.json();
      setAlerts(data.alerts ?? []);
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Failed to load' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts(statusFilter);
  }, [fetchAlerts, statusFilter]);

  const dismissAlert = async (alertId: string) => {
    setDismissingId(alertId);
    setMessage(null);
    try {
      const response = await fetchWithCsrf(`/api/admin/service-alerts/${alertId}/dismiss`, {
        method: 'POST',
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to dismiss alert');
      }
      setMessage({ type: 'success', text: 'Alert dismissed.' });
      await fetchAlerts(statusFilter);
    } catch (error) {
      setMessage({
        type: 'error',
        text: error instanceof Error ? error.message : 'Failed to dismiss',
      });
    } finally {
      setDismissingId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Service Alerts</CardTitle>
            <CardDescription>
              Operational alerts raised by monitoring and automation rules. Dismissal is
              audited; a recurring failure reopens the alert as a new occurrence.
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={() => fetchAlerts(statusFilter)} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>
        <div className="flex gap-2 pt-2">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter}
              onClick={() => setStatusFilter(filter)}
              className={`rounded-md px-3 py-1 text-sm ${
                statusFilter === filter
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80'
              }`}
            >
              {filter}
            </button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {message && (
          <Alert variant={message.type === 'error' ? 'destructive' : 'default'} className="mb-4">
            <AlertDescription>{message.text}</AlertDescription>
          </Alert>
        )}
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : alerts.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No service alerts.</p>
        ) : (
          <div className="space-y-3">
            {alerts.map((alert) => (
              <div key={alert.id} className="rounded-lg border p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={severityVariant(alert.severity)}>{alert.severity}</Badge>
                      <Badge variant="outline">{alert.category}</Badge>
                      <Badge variant="outline">{alert.status}</Badge>
                      {alert.occurrenceCount > 1 && (
                        <span className="text-xs text-muted-foreground">
                          {alert.occurrenceCount} occurrences
                        </span>
                      )}
                    </div>
                    <p className="mt-2 font-medium">{alert.title}</p>
                    <p className="text-sm text-muted-foreground">{alert.message}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Source: {alert.source} · First seen {new Date(alert.firstSeenAt).toLocaleString()} · Last seen{' '}
                      {new Date(alert.lastSeenAt).toLocaleString()}
                      {alert.dismissedBy && ` · Dismissed by ${alert.dismissedBy}`}
                    </p>
                  </div>
                  {(alert.status === 'active' || alert.status === 'resolved') && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={dismissingId === alert.id}
                      onClick={() => dismissAlert(alert.id)}
                    >
                      {dismissingId === alert.id && <Loader2 className="h-4 w-4 animate-spin" />}
                      Dismiss
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
