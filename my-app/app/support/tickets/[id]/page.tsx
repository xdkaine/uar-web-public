import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { NextRequest } from 'next/server';

import { GET as getTicket } from '@/app/api/support/tickets/[id]/route';
import { LazyMotionBoundary } from '@/components/animations/LazyMotionBoundary';

import TicketDetailClient, { type Ticket } from './TicketDetailClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Ticket Details | User Access Request (UAR) Portal',
};

interface TicketDetailPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ evidenceFailed?: string | string[] }>;
}

export default async function TicketDetailPage({ params, searchParams }: TicketDetailPageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const response = await getTicket(
    new NextRequest(`http://uar.internal/api/support/tickets/${encodeURIComponent(id)}`, {
      headers: new Headers(await headers()),
    }),
    { params: Promise.resolve({ id }) }
  );

  if (response.status === 401) {
    redirect('/login?redirect=/support/tickets');
  }
  if (response.status === 403 || response.status === 404) {
    notFound();
  }

  const body = await response.json() as { ticket?: Ticket; error?: string };
  if (!response.ok || !body.ticket) {
    throw new Error(body.error ?? 'Unable to load this ticket');
  }

  return (
    <LazyMotionBoundary>
      <TicketDetailClient
        initialTicket={body.ticket}
        ticketId={id}
        evidenceFailed={query.evidenceFailed === '1'}
      />
    </LazyMotionBoundary>
  );
}
