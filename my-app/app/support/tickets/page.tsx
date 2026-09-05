import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { GET as getTickets } from '@/app/api/support/tickets/route';
import { LazyMotionBoundary } from '@/components/animations/LazyMotionBoundary';

import TicketsClient, { type Ticket } from './TicketsClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'My Support Tickets | User Access Request (UAR) Portal',
};

export default async function MyTicketsPage() {
  const response = await getTickets();
  if (response.status === 401) {
    redirect('/login?redirect=/support/tickets');
  }

  const body = await response.json() as { tickets?: Ticket[]; error?: string };
  return (
    <LazyMotionBoundary>
      <TicketsClient
        tickets={response.ok ? body.tickets ?? [] : []}
        loadError={response.ok ? '' : body.error ?? 'An error occurred'}
      />
    </LazyMotionBoundary>
  );
}
