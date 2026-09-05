import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import type { ActionHistoryItem } from '@/types/api';

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function subjectLabel(item: ActionHistoryItem): string {
  return item.subjectName || item.subjectUsername || item.subjectEmail || item.relatedRequestId || item.relatedVpnAccountId || 'Unknown';
}

function formatTimestamp(value: string): string {
  return new Date(value).toLocaleString();
}

interface ActionHistoryDetailDialogProps {
  item: ActionHistoryItem | null;
  onOpenChange: (open: boolean) => void;
}

export function ActionHistoryDetailDialog({ item, onOpenChange }: ActionHistoryDetailDialogProps) {
  return (
    <Dialog open={Boolean(item)} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle className="wrap-break-word">{item?.title || 'Action History Details'}</DialogTitle></DialogHeader>
        {item && (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Detail label="Time">{formatTimestamp(item.createdAt)}</Detail>
              <Detail label="Source">{item.source}</Detail>
              <Detail label="Actor">{item.actor} ({item.actorType})</Detail>
              <Detail label="Subject">{subjectLabel(item)}</Detail>
              <Detail label="IP Address">{item.ipAddress || 'None'}</Detail>
              {item.userAgent && <Detail label="User Agent" className="sm:col-span-2">{item.userAgent}</Detail>}
            </div>
            {item.description && <p className="rounded border border-border bg-muted/50 p-3 text-sm text-muted-foreground whitespace-pre-wrap wrap-break-word">{item.description}</p>}
            {item.details && Object.keys(item.details).length > 0 && (
              <dl className="grid gap-2 text-xs sm:grid-cols-2">
                {Object.entries(item.details).map(([key, value]) => (
                  <div key={key} className="rounded border border-border bg-muted/50 p-2">
                    <dt className="font-medium text-muted-foreground">{key}</dt>
                    <dd className="mt-1 max-h-40 overflow-y-auto font-mono text-[11px] text-foreground whitespace-pre-wrap wrap-break-word">{formatValue(value)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Detail({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return <div className={className}><Label className="text-xs text-muted-foreground">{label}</Label><p className="text-sm text-foreground wrap-break-word">{children}</p></div>;
}
