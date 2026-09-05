import RichTextContent from '@/components/support/RichTextContent';
import { ticketCategoryLabel } from '@/lib/support/ticket-categories';

import type { Ticket } from './AdminTicketTypes';
import { getSeverityColor, getStatusColor, formatStatus } from './AdminTicketUi';

export function AdminTicketSummary({ ticket }: { ticket: Ticket }) {
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
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-2">
              {ticket.subject}
            </h1>
          </div>
        </div>

        <div className="border-t border-border pt-4">
          <RichTextContent content={ticket.body} />
        </div>
      </div>
    </div>
  );
}
