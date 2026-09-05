import TicketEvidence from '@/components/support/TicketEvidence';
import RichTextContent from '@/components/support/RichTextContent';
import { ticketCategoryLabel } from '@/lib/support/ticket-categories';

import type { Ticket } from './TicketDetailTypes';
import { getSeverityColor, getStatusColor, formatStatus } from './TicketDetailUi';

interface TicketDetailContentProps {
  ticket: Ticket;
  ticketId: string;
  canMutateEvidence: boolean;
}

export function TicketSummary({ ticket }: Pick<TicketDetailContentProps, 'ticket'>) {
  return (
    <div className="bg-card rounded-lg shadow-sm border border-border p-6">
      <div className="flex flex-col gap-4">
        <div className="flex justify-between items-start">
          <div>
            <div className="flex gap-2 mb-3 flex-wrap">
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(ticket.status)}`}>
                {formatStatus(ticket.status)}
              </span>
              {ticket.category && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800">
                  {ticketCategoryLabel(ticket.category)}
                </span>
              )}
              {ticket.severity && (
                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${getSeverityColor(ticket.severity)}`}>
                  {ticket.severity.toUpperCase()}
                </span>
              )}
              {ticket.viewerRole === 'group_member' && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 dark:bg-indigo-950/60 text-indigo-800">
                  Group ticket · read only
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="border-t border-border/70 pt-4">
          <RichTextContent content={ticket.body} />
        </div>
      </div>
    </div>
  );
}

export function TicketEvidencePanel({ ticketId, canMutateEvidence }: Omit<TicketDetailContentProps, 'ticket'>) {
  return (
    <div className="bg-card rounded-lg shadow-sm border border-border p-6">
      <h2 className="text-lg font-bold text-foreground mb-4 flex items-center gap-2">
        Evidence
        <span className="text-xs font-normal text-muted-foreground">screenshots &amp; documents</span>
      </h2>
      <TicketEvidence ticketId={ticketId} canMutate={canMutateEvidence} />
    </div>
  );
}
