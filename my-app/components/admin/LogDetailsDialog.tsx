import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/ui/status-badge';
import { AccountName } from './AccountName';
import { getActionDisplayName, getCategoryTone, getLogOutcomePresentation } from './LogsHelpers';
import { LogsLocalizedDateTime } from './LogsLocalizedTime';
import type { AuditLog } from './LogsTypes';

interface LogDetailsDialogProps { log: AuditLog | null; onOpenChange: (open: boolean) => void; }

function LogDetail({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return <div className={className}><dt className="text-sm font-medium text-muted-foreground">{label}</dt><dd className="mt-1 text-sm text-foreground">{children}</dd></div>;
}

export function LogDetailsDialog({ log, onOpenChange }: LogDetailsDialogProps) {
  return <Dialog open={Boolean(log)} onOpenChange={onOpenChange}>{log && <DialogContent onOpenAutoFocus={(event) => { event.preventDefault(); (event.target as HTMLElement).querySelector<HTMLElement>('[data-log-title]')?.focus(); }} className="flex max-h-[90vh] max-w-3xl flex-col gap-0 overflow-y-auto p-0"><DialogHeader className="border-b p-5"><DialogTitle data-log-title tabIndex={-1}>Audit log details</DialogTitle><DialogDescription>Complete details for the selected audit event.</DialogDescription></DialogHeader><LogDetailsBody log={log} /><div className="sticky bottom-0 border-t bg-muted/50 p-4"><Button type="button" onClick={() => onOpenChange(false)} className="w-full">Close</Button></div></DialogContent>}</Dialog>;
}

function LogDetailsBody({ log }: { log: AuditLog }) {
  const outcome = getLogOutcomePresentation(log.outcome, log.success);
  return <div className="flex-1 space-y-4 overflow-y-auto p-5"><dl className="grid grid-cols-1 gap-4 sm:grid-cols-2"><LogDetail label="Timestamp"><LogsLocalizedDateTime value={log.createdAt} /></LogDetail><LogDetail label="Actor"><AccountName username={log.username} displayName={log.actorDisplayName} /></LogDetail>{log.actorType && <LogDetail label="Actor type"><span className="capitalize">{log.actorType}</span></LogDetail>}<LogDetail label="Category"><StatusBadge tone={getCategoryTone(log.category)} emphasis="outline" className="capitalize">{log.category}</StatusBadge></LogDetail><LogDetail label="Action">{getActionDisplayName(log.action)}</LogDetail><LogDetail label="Outcome"><StatusBadge tone={outcome.tone}>{outcome.label}</StatusBadge></LogDetail><LogDetail label="Log ID"><span className="break-all font-mono text-xs">{log.id}</span></LogDetail>{log.eventKind && <LogDetail label="Event kind"><Badge variant="outline" className="capitalize">{log.eventKind}</Badge></LogDetail>}</dl><LogRelatedDetails log={log} /><LogTechnicalDetails log={log} /></div>;
}

function LogRelatedDetails({ log }: { log: AuditLog }) {
  const entries = [{ label: 'Subject', value: log.subjectUsername || log.subjectDisplayName ? <AccountName username={log.subjectUsername} displayName={log.subjectDisplayName} /> : null }, { label: 'Subject email', value: log.subjectEmail }, { label: 'Related request', value: log.relatedRequestId }, { label: 'Related VPN account', value: log.relatedVpnAccountId }, { label: 'Related lifecycle action', value: log.relatedLifecycleActionId }, { label: 'Correlation ID', value: log.correlationId }].filter((entry) => entry.value);
  if (entries.length === 0) return null;
  return <dl className="grid grid-cols-1 gap-3 rounded-md border border-border bg-muted/30 p-3 sm:grid-cols-2">{entries.map((entry) => <LogDetail key={entry.label} label={entry.label}><span className={typeof entry.value === 'string' && entry.label !== 'Subject email' ? 'break-all font-mono text-xs' : 'break-all'}>{entry.value}</span></LogDetail>)}</dl>;
}

function LogTechnicalDetails({ log }: { log: AuditLog }) {
  return <div className="space-y-4">{log.targetType && <dl><LogDetail label="Target"><span className="font-medium">{log.targetType}</span>{log.targetId && <span className="ml-2 break-all font-mono text-xs text-muted-foreground">{log.targetId}</span>}</LogDetail></dl>}{log.ipAddress && <dl><LogDetail label="IP address"><span className="font-mono">{log.ipAddress}</span></LogDetail></dl>}{log.userAgent && <dl><LogDetail label="User agent"><span className="break-all">{log.userAgent}</span></LogDetail></dl>}{log.errorMessage && <dl><LogDetail label="Error message"><span className="block whitespace-pre-wrap rounded-md border border-destructive/30 bg-destructive/5 p-3 text-destructive">{log.errorMessage}</span></LogDetail></dl>}{log.details && Object.keys(log.details).length > 0 && <dl><LogDetail label="Additional details"><pre className="max-h-80 overflow-y-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted/30 p-3 text-xs">{JSON.stringify(log.details, null, 2)}</pre></LogDetail></dl>}</div>;
}
