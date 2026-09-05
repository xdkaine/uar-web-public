'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Clock3, ExternalLink, Paperclip, UserRound, UsersRound } from 'lucide-react';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { htmlToPlainText } from '@/lib/ticket-content';
import { LocalizedDateTime } from './LocalizedDateTime';

const TICKET_PEEK_OPEN_EVENT = 'uar:ticket-peek-open';

interface TicketPeekProps {
  ticket: {
    id: string;
    subject: string;
    body?: string;
    username?: string;
    displayName?: string;
    status: string;
    severity?: string | null;
    updatedAt: string;
    assignees?: string[];
    attachmentCount?: number;
  };
  href?: string;
  showAssignees?: boolean;
}

export default function TicketPeek({
  ticket,
  href = `/admin/support/tickets/${ticket.id}`,
  showAssignees = true,
}: TicketPeekProps) {
  const [open, setOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const owners = Array.from(new Set([
    ticket.displayName || ticket.username || 'Ticket requester',
    'Support staff',
    ...(ticket.assignees?.filter(Boolean) ?? []),
  ]));
  const excerpt = htmlToPlainText(ticket.body ?? '').slice(0, 180);

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    if (open) return;
    if (openTimer.current) clearTimeout(openTimer.current);
    openTimer.current = setTimeout(() => {
      window.dispatchEvent(new CustomEvent(TICKET_PEEK_OPEN_EVENT, { detail: ticket.id }));
      setOpen(true);
    }, 90);
  };
  const hideSoon = () => {
    if (openTimer.current) clearTimeout(openTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 120);
  };

  useEffect(() => {
    const closeWhenAnotherOpens = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== ticket.id) setOpen(false);
    };
    window.addEventListener(TICKET_PEEK_OPEN_EVENT, closeWhenAnotherOpens);
    return () => {
      window.removeEventListener(TICKET_PEEK_OPEN_EVENT, closeWhenAnotherOpens);
      if (openTimer.current) clearTimeout(openTimer.current);
      if (closeTimer.current) clearTimeout(closeTimer.current);
    };
  }, [ticket.id]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Link
          href={href}
          className="max-w-full text-left font-medium text-foreground underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onMouseEnter={show}
          onMouseLeave={hideSoon}
          onFocus={show}
          onBlur={hideSoon}
          onClick={(event) => event.stopPropagation()}
          aria-label={`Open ticket ${ticket.subject}`}
        >
          <span className="block truncate">{ticket.subject}</span>
        </Link>
      </PopoverTrigger>
      <PopoverContent
        className="w-[min(24rem,calc(100vw-2rem))] space-y-3 p-4 motion-reduce:animate-none"
        onMouseEnter={show}
        onMouseLeave={hideSoon}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div>
          <p className="text-sm font-semibold leading-snug">{ticket.subject}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">#{ticket.id.slice(0, 8)}</p>
        </div>
        {excerpt && <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{excerpt}</p>}
        <dl className="grid gap-2 text-xs">
          <div className="flex items-start gap-2">
            <UserRound className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
            <dt className="sr-only">Requester</dt>
            <dd>{ticket.displayName || ticket.username || 'Unknown requester'}</dd>
          </div>
          {showAssignees && (
            <div className="flex items-start gap-2">
              <UsersRound className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
              <dt className="sr-only">People and groups with ticket access</dt>
              <dd>{owners.join(', ')}</dd>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
            <span className="capitalize">{ticket.status.replaceAll('_', ' ')}</span>
            <span className="capitalize">{ticket.severity || 'No severity'}</span>
            <span className="inline-flex items-center gap-1"><Paperclip className="h-3.5 w-3.5" />{ticket.attachmentCount ?? 0}</span>
            <span className="inline-flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" /><LocalizedDateTime value={ticket.updatedAt} /></span>
          </div>
        </dl>
        <Link
          href={href}
          onClick={() => setOpen(false)}
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          Open ticket <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </PopoverContent>
    </Popover>
  );
}
