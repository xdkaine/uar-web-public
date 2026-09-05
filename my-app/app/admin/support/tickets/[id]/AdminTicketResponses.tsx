import type { FormEvent } from 'react';

import { LocalizedDateTime } from '@/components/support/LocalizedDateTime';
import { RichTextEditor } from '@/components/support/RichTextEditor';
import RichTextContent from '@/components/support/RichTextContent';
import { isEmptyRichText } from '@/lib/ticket-content';

import type { Ticket } from './AdminTicketTypes';

interface AdminTicketResponsesProps {
  ticket: Ticket;
  newResponse: string;
  submittingResponse: boolean;
  onResponseChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

export function AdminTicketResponses({ ticket, newResponse, submittingResponse, onResponseChange, onSubmit }: AdminTicketResponsesProps) {
  return (
    <div className="bg-card rounded-lg shadow-sm border border-border p-6">
      <h2 className="text-lg font-bold text-foreground mb-6 flex items-center gap-2">
        Responses
        <span className="bg-muted text-muted-foreground px-2 py-0.5 rounded-full text-xs">
          {ticket.responses.length}
        </span>
      </h2>

      {ticket.responses.length === 0 ? (
        <div className="text-center py-8 bg-muted/50 rounded-lg mb-6 border border-dashed border-border">
          <p className="text-muted-foreground">No responses yet.</p>
        </div>
      ) : (
        <div className="space-y-6 mb-8">
          {ticket.responses.map((response) => (
            <div key={response.id} className="flex gap-4">
              <div className="flex-shrink-0 mt-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${response.isStaff ? 'bg-primary text-white' : 'bg-muted text-muted-foreground'
                  }`}>
                  {(response.authorDisplayName || response.author).charAt(0).toUpperCase()}
                </div>
              </div>
              <div className="flex-1">
                <div className="bg-muted/50 rounded-lg p-4 border border-border">
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground text-sm">
                        {response.authorDisplayName || response.author}
                      </span>
                      {response.isStaff && (
                        <span className="px-2 py-0.5 bg-primary text-primary-foreground text-[10px] uppercase font-bold tracking-wider rounded">
                          Staff
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      <LocalizedDateTime value={response.createdAt} />
                    </span>
                  </div>
                  <div className="text-foreground text-sm [&_p]:leading-relaxed">
                    <RichTextContent content={response.message} />
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {ticket.status !== 'closed' ? (
        <form onSubmit={onSubmit} className="border-t border-border pt-6">
          <label htmlFor="response" className="block text-sm font-medium text-muted-foreground mb-2">
            Add a Response
          </label>
          <RichTextEditor
            value={newResponse}
            onChange={onResponseChange}
            disabled={submittingResponse}
            ariaLabel="Type your response here"
          />
          <div className="mt-4 flex justify-end">
            <button
              type="submit"
              disabled={submittingResponse || isEmptyRichText(newResponse)}
              className="px-6 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
            >
              {submittingResponse ? 'Submitting...' : 'Submit Response'}
            </button>
          </div>
        </form>
      ) : (
        <div className="border-t border-border pt-6">
          <div className="bg-muted/50 border border-border rounded-lg p-4 flex items-center gap-3 text-muted-foreground">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 00-2 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
            <p className="text-sm font-medium">This ticket is closed. Reopen it to add more responses.</p>
          </div>
        </div>
      )}
    </div>
  );
}
