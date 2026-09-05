import { LocalizedDateTime } from '@/components/support/LocalizedDateTime';

import type { Ticket } from './TicketDetailTypes';
import { formatStatus } from './TicketDetailUi';

interface TicketDetailSidebarProps {
  ticket: Ticket;
  updatingStatus: boolean;
  onUpdateStatus: (status: string) => void;
}

export function TicketDetailSidebar({ ticket, updatingStatus, onUpdateStatus }: TicketDetailSidebarProps) {
  return (
    <div className="space-y-6">
      <div className="bg-card rounded-lg shadow-sm border border-border p-6">
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-4">Ticket Details</h3>
        <div className="space-y-4">
          <div><div className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">Ticket ID</div><div className="font-mono text-sm bg-muted px-2 py-1 rounded inline-block text-foreground/90">{ticket.id.slice(0, 8)}</div></div>
          <div><div className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">Reported By</div><div className="text-sm font-medium text-foreground">{ticket.displayName || ticket.username}</div><div className="text-xs text-muted-foreground">{ticket.username}</div></div>
          <div><div className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">Created</div><div className="text-sm text-foreground"><LocalizedDateTime value={ticket.createdAt} /></div></div>
          <div><div className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">Last Updated</div><div className="text-sm text-foreground"><LocalizedDateTime value={ticket.updatedAt} /></div></div>
          {ticket.closedAt && <div><div className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">Closed</div><div className="text-sm text-foreground"><LocalizedDateTime value={ticket.closedAt} /></div></div>}
        </div>
        <div className="mt-6 pt-6 border-t border-border/70">
          {ticket.status !== 'closed' ? (
            <button onClick={() => onUpdateStatus('closed')} disabled={updatingStatus} className="w-full px-4 py-2 bg-card border border-border text-foreground/90 rounded-md text-sm font-medium hover:bg-accent/50 transition-colors disabled:bg-muted">
              {updatingStatus ? 'Closing...' : 'Close Ticket'}
            </button>
          ) : (
            <button onClick={() => onUpdateStatus('open')} disabled={updatingStatus} className="w-full px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors disabled:bg-blue-400">
              {updatingStatus ? 'Reopening...' : 'Reopen Ticket'}
            </button>
          )}
        </div>
      </div>
      <TicketHistory ticket={ticket} />
    </div>
  );
}

function TicketHistory({ ticket }: Pick<TicketDetailSidebarProps, 'ticket'>) {
  return (
    <div className="bg-card rounded-lg shadow-sm border border-border p-6">
      <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-4">History</h3>
      {!ticket.statusLogs || ticket.statusLogs.length === 0 ? <p className="text-sm text-muted-foreground">No history available.</p> : (
        <div className="relative border-l-2 border-border/70 ml-2 space-y-6">
          {ticket.statusLogs.map((log) => (
            <div key={log.id} className="relative pl-6">
              <div className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-border border-2 border-white" />
              <div className="text-sm">
                <span className="font-semibold text-foreground">{log.changedByDisplayName || log.changedBy}</span>
                <div className="text-xs text-muted-foreground mb-1"><LocalizedDateTime value={log.createdAt} /></div>
                <p className="text-foreground/90 text-xs">
                  {log.oldStatus ? <>Changed from <span className="font-medium">{formatStatus(log.oldStatus)}</span> to <span className="font-medium">{formatStatus(log.newStatus)}</span></> : <>Created as <span className="font-medium">{formatStatus(log.newStatus)}</span></>}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
