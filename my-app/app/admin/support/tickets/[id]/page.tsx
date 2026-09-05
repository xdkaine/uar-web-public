import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { NextRequest } from 'next/server';

import { GET as getTicket } from '@/app/api/support/tickets/[id]/route';
import { LazyMotionBoundary } from '@/components/animations/LazyMotionBoundary';

import AdminTicketDetailClient, { type Ticket } from './AdminTicketDetailClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Admin - Ticket Details | User Access Request (UAR) Portal',
};

interface AdminTicketDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminTicketDetailPage({ params }: AdminTicketDetailPageProps) {
  const { id } = await params;
  const response = await getTicket(
    new NextRequest(`http://uar.internal/api/support/tickets/${encodeURIComponent(id)}`, {
      headers: new Headers(await headers()),
    }),
    { params: Promise.resolve({ id }) }
  );

  if (response.status === 401) {
    redirect(`/login?redirect=${encodeURIComponent(`/admin/support/tickets/${id}`)}`);
  }
  if (response.status === 403) {
    redirect('/admin');
  }
  if (response.status === 404) {
    notFound();
  }

  const body = await response.json() as { ticket?: Ticket; error?: string };
  if (!response.ok || !body.ticket) {
    throw new Error(body.error ?? 'Unable to load this ticket');
  }

  return (
    <LazyMotionBoundary>
      <AdminTicketDetailClient initialTicket={body.ticket} ticketId={id} />
    </LazyMotionBoundary>
  );
}
