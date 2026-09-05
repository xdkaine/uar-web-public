'use client';

import { use, useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Printer } from 'lucide-react';

/**
 * Print-friendly per-request governance dossier. All data comes from the
 * permission-gated dossier API (audit.read); credential material is excluded
 * server-side at the query level and can never appear on this page.
 */

interface DossierPayload {
  generatedAt: string;
  request: Record<string, unknown>;
  governance: {
    requestTypeKey: string;
    version: number;
    versionStatus: string;
    publishedAt: string;
    stages: unknown;
  } | null;
  comments: Array<{
    id: string;
    createdAt: string;
    author: string;
    type: string | null;
    comment: string;
  }>;
  auditTrail: Array<{
    id: string;
    action: string;
    category: string;
    eventKind: string | null;
    outcome: string | null;
    success: boolean | null;
    username: string;
    actorType: string | null;
    errorMessage: string | null;
    correlationId: string | null;
    createdAt: string;
  }>;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
    return new Date(value).toLocaleString();
  }
  return String(value);
}

const REQUEST_FIELDS: Array<{ key: string; label: string }> = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'isInternal', label: 'Internal' },
  { key: 'status', label: 'Status' },
  { key: 'needsDomainAccount', label: 'Domain account requested' },
  { key: 'institution', label: 'Institution' },
  { key: 'eventReason', label: 'Reason / Event' },
  { key: 'ldapUsername', label: 'AD username' },
  { key: 'vpnUsername', label: 'VPN username' },
  { key: 'createdAt', label: 'Submitted' },
  { key: 'verifiedAt', label: 'Verified at' },
  { key: 'acknowledgedBy', label: 'Acknowledged by' },
  { key: 'acknowledgedAt', label: 'Acknowledged at' },
  { key: 'sentToFacultyBy', label: 'Sent to faculty by' },
  { key: 'sentToFacultyAt', label: 'Sent to faculty at' },
  { key: 'manuallyAssignedBy', label: 'Manually assigned by' },
  { key: 'approvedBy', label: 'Approved by' },
  { key: 'approvedAt', label: 'Approved at' },
  { key: 'rejectedBy', label: 'Rejected by' },
  { key: 'rejectionReason', label: 'Rejection reason' },
  { key: 'provisioningState', label: 'Provisioning state' },
  { key: 'provisioningError', label: 'Provisioning error' },
  { key: 'accountCreatedAt', label: 'Account created' },
  { key: 'accountExpiresAt', label: 'Account expires' },
  { key: 'adAccountStatus', label: 'AD status' },
  { key: 'vpnAccountStatus', label: 'VPN tracking status' },
];

const AUDIT_FIELDS: Array<{ key: keyof DossierPayload['auditTrail'][number]; label: string }> = [
  { key: 'createdAt', label: 'When' },
  { key: 'action', label: 'Action' },
  { key: 'username', label: 'Actor' },
  { key: 'outcome', label: 'Outcome' },
];

export default function RequestDossierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [dossier, setDossier] = useState<DossierPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/requests/${id}/dossier`);
      if (response.status === 401 || response.status === 403) {
        throw new Error('You do not have access to audit evidence for this portal.');
      }
      if (!response.ok) throw new Error('Failed to load dossier');
      const data = await response.json();
      setDossier(data.dossier);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (error || !dossier) {
    return (
      <div className="mx-auto max-w-2xl p-8">
        <Alert variant="destructive">
          <AlertDescription>{error ?? 'Dossier unavailable'}</AlertDescription>
        </Alert>
      </div>
    );
  }

  const request = dossier.request;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6 print:p-0">
      <div className="flex items-center justify-between print:hidden">
        <h1 className="text-xl font-semibold">Access Request Dossier</h1>
        <Button onClick={() => window.print()} size="sm" variant="outline">
          <Printer className="mr-2 h-4 w-4" />
          Print / Save PDF
        </Button>
      </div>

      <Card className="print:border-none print:shadow-none">
        <CardHeader>
          <CardTitle className="flex flex-wrap items-center gap-2 text-base">
            <span className="font-mono text-xs">{dossier.request.id as string}</span>
            <Badge variant="secondary">{formatValue(request.status)}</Badge>
            <span className="text-xs font-normal text-muted-foreground">
              Generated {new Date(dossier.generatedAt).toLocaleString()}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {REQUEST_FIELDS.map((field) => (
            <div key={field.key} className="grid grid-cols-3 gap-2 text-sm">
              <span className="font-medium">{field.label}</span>
              <span className="col-span-2 break-all">{formatValue(request[field.key])}</span>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="print:border-none print:shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Governance applied</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1.5 text-sm">
          {dossier.governance ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <span className="font-medium">Request type</span>
                <span className="col-span-2 font-mono text-xs">{dossier.governance.requestTypeKey}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <span className="font-medium">Workflow version</span>
                <span className="col-span-2">v{dossier.governance.version} ({dossier.governance.versionStatus})</span>
              </div>
              <p className="pt-1 text-xs text-muted-foreground">
                This request is pinned to the workflow version above; later edits cannot alter its
                governance history.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">
              Submitted before configurable workflows; legacy status machine applies.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="print:border-none print:shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Decisions &amp; comments ({dossier.comments.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {dossier.comments.map((comment) => (
            <div key={comment.id} className="rounded border p-2 text-sm">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{comment.author}</span>
                <span>{new Date(comment.createdAt).toLocaleString()}</span>
                {comment.type && <Badge variant="outline">{comment.type}</Badge>}
              </div>
              <p className="whitespace-pre-wrap pt-1">{comment.comment}</p>
            </div>
          ))}
          {dossier.comments.length === 0 && (
            <p className="text-sm text-muted-foreground">No comments recorded.</p>
          )}
        </CardContent>
      </Card>

      <Card className="print:border-none print:shadow-none">
        <CardHeader>
          <CardTitle className="text-base">Audit trail ({dossier.auditTrail.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left">
                {AUDIT_FIELDS.map((field) => (
                  <th key={field.key as string} className="py-1 pr-3 font-semibold">
                    {field.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dossier.auditTrail.map((entry) => (
                <tr key={entry.id} className="border-b last:border-none align-top">
                  <td className="py-1 pr-3 whitespace-nowrap">{new Date(entry.createdAt).toLocaleString()}</td>
                  <td className="py-1 pr-3 font-mono">{entry.action}</td>
                  <td className="py-1 pr-3">
                    {entry.username}
                    {entry.actorType && ` (${entry.actorType})`}
                  </td>
                  <td className="py-1 pr-3">
                    {entry.outcome ?? '-'}
                    {entry.success === false && entry.errorMessage && (
                      <span className="block text-destructive">{entry.errorMessage}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
