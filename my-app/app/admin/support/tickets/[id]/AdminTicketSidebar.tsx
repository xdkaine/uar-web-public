import { TicketAssignmentSection } from '@/components/admin/TicketDetailModal';
import { LocalizedDateTime } from '@/components/support/LocalizedDateTime';
import TicketEvidence from '@/components/support/TicketEvidence';

import type { Ticket } from './AdminTicketTypes';
import { formatStatus } from './AdminTicketUi';

interface AdminTicketSidebarProps {
  ticket: Ticket;
  updatingStatus: boolean;
  onUpdateStatus: (status: string) => void;
}

export function AdminTicketSidebar({ ticket, updatingStatus, onUpdateStatus }: AdminTicketSidebarProps) {
  return (
    <div className="space-y-6">
      <div className="bg-card rounded-lg shadow-sm border border-border p-6">
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-4">
          Ticket Details
        </h3>
        <div className="space-y-4">
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">Ticket ID</div>
            <div className="font-mono text-sm bg-muted px-2 py-1 rounded inline-block text-muted-foreground">
              {ticket.id.slice(0, 8)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">Reported By</div>
            <div className="text-sm font-medium text-foreground">{ticket.displayName || ticket.username}</div>
            <div className="text-xs text-muted-foreground">{ticket.username}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">Owners</div>
            <div className="text-sm font-medium text-foreground">
              {[ticket.displayName || ticket.username, 'Support staff', ...(ticket.assignees ?? [])].join(', ')}
            </div>
          </div>
          {ticket.requestedForGroupDn && (
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">Requested For</div>
              <div className="break-all font-mono text-xs text-foreground">{ticket.requestedForGroupDn}</div>
            </div>
          )}
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">Created</div>
            <div className="text-sm text-foreground"><LocalizedDateTime value={ticket.createdAt} /></div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">Last Updated</div>
            <div className="text-sm text-foreground"><LocalizedDateTime value={ticket.updatedAt} /></div>
          </div>
          {ticket.closedAt && (
            <div>
              <div className="text-xs text-muted-foreground uppercase tracking-wide font-semibold mb-1">Closed</div>
              <div className="text-sm text-foreground"><LocalizedDateTime value={ticket.closedAt} /></div>
              {ticket.closedBy && (
                <div className="text-xs text-muted-foreground">by {ticket.closedBy}</div>
              )}
            </div>
          )}
        </div>

        <div className="mt-6 pt-6 border-t border-border space-y-3">
          {ticket.status !== 'closed' && (
            <>
              {ticket.status !== 'in_progress' && (
                <button
                  onClick={() => onUpdateStatus('in_progress')}
                  disabled={updatingStatus}
                  className="w-full px-4 py-2 bg-purple-600 text-white rounded-md text-sm font-medium hover:bg-purple-700 transition-colors disabled:bg-purple-400"
                >
                  {updatingStatus ? 'Updating...' : 'Mark In Progress'}
                </button>
              )}
              <button
                onClick={() => onUpdateStatus('closed')}
                disabled={updatingStatus}
                className="w-full px-4 py-2 bg-card border border-border text-muted-foreground rounded-md text-sm font-medium hover:bg-muted/50 transition-colors disabled:bg-muted"
              >
                {updatingStatus ? 'Closing...' : 'Close Ticket'}
              </button>
            </>
          )}
          {ticket.status === 'closed' && (
            <button
              onClick={() => onUpdateStatus('open')}
              disabled={updatingStatus}
              className="w-full px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors disabled:bg-blue-400"
            >
              {updatingStatus ? 'Reopening...' : 'Reopen Ticket'}
            </button>
          )}
        </div>
      </div>

      <div className="bg-card rounded-lg shadow-sm border border-border p-6">
        <TicketAssignmentSection
          ticketId={ticket.id}
          requesterName={ticket.displayName}
          requesterUsername={ticket.username}
        />
      </div>

      <div className="bg-card rounded-lg shadow-sm border border-border p-6">
        <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-4">Evidence</h3>
        <TicketEvidence ticketId={ticket.id} canMutate />
      </div>

      <AdminTicketHistory ticket={ticket} />
    </div>
  );
}

function AdminTicketHistory({ ticket }: Pick<AdminTicketSidebarProps, 'ticket'>) {
  return (
    <div className="bg-card rounded-lg shadow-sm border border-border p-6">
      <h3 className="text-sm font-bold text-foreground uppercase tracking-wider mb-4">
        History
      </h3>

      {!ticket.statusLogs || ticket.statusLogs.length === 0 ? (
        <p className="text-sm text-muted-foreground">No history available.</p>
      ) : (
        <div className="relative border-l-2 border-border ml-2 space-y-6">
          {ticket.statusLogs.map((log) => (
            <div key={log.id} className="relative pl-6">
              <div className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-border border-2 border-white"></div>
              <div className="text-sm">
                <span className="font-semibold text-foreground">
                  {log.changedByDisplayName || log.changedBy}
                </span>
                <div className="text-xs text-muted-foreground mb-1">
                  <LocalizedDateTime value={log.createdAt} />
                </div>
                <p className="text-muted-foreground text-xs">
                  {log.oldStatus ? (
                    <>
                      Changed from <span className="font-medium">{formatStatus(log.oldStatus)}</span> to <span className="font-medium">{formatStatus(log.newStatus)}</span>
                    </>
                  ) : (
                    <>
                      Created as <span className="font-medium">{formatStatus(log.newStatus)}</span>
                    </>
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
