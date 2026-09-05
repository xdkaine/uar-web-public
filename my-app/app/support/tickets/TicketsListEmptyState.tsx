'use client';

import { Inbox, Plus, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';

interface TicketsListEmptyStateProps {
  hasTickets: boolean;
  onCreateTicket: () => void;
}

export default function TicketsListEmptyState({ hasTickets, onCreateTicket }: TicketsListEmptyStateProps) {
  return (
    <div className="p-16 text-center">
      <div className="mx-auto mb-4 inline-flex items-center justify-center rounded-full bg-muted p-3">
        {hasTickets ? (
          <Search className="h-6 w-6 text-muted-foreground" />
        ) : (
          <Inbox className="h-6 w-6 text-muted-foreground" />
        )}
      </div>
      <h3 className="text-base font-semibold text-foreground">
        {hasTickets ? 'Nothing matches these filters' : 'No tickets yet'}
      </h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {hasTickets
          ? 'Try adjusting your search or clearing the active filters.'
          : 'When you submit a support request it will show up here.'}
      </p>
      {!hasTickets && (
        <Button onClick={onCreateTicket} className="mt-5">
          <Plus className="mr-2 h-4 w-4" />
          Create your first ticket
        </Button>
      )}
    </div>
  );
}
