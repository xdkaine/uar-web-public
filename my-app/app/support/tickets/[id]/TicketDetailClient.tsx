'use client';

import type { FormEvent } from 'react';
import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import * as m from 'framer-motion/m';
import useSWR from 'swr';

import PortalPageHeading from '@/components/appearance/PortalPageHeading';
import { fetchWithCsrf } from '@/lib/csrf';
import { ClientQueryError, fetchJson } from '@/lib/client-query';
import { isEmptyRichText } from '@/lib/ticket-content';

import { TicketEvidencePanel, TicketSummary } from './TicketDetailContent';
import { TicketDetailSidebar } from './TicketDetailSidebar';
import type { Ticket } from './TicketDetailTypes';
import { TicketResponses } from './TicketResponses';

export type { Ticket } from './TicketDetailTypes';

interface TicketDetailClientProps {
  initialTicket: Ticket;
  ticketId: string;
  evidenceFailed: boolean;
}

export default function TicketDetailClient({ initialTicket, ticketId, evidenceFailed }: TicketDetailClientProps) {
  const router = useRouter();
  const responseRequestId = useRef<string | null>(null);
  const [error, setError] = useState('');
  const [newResponse, setNewResponse] = useState('');
  const [submittingResponse, setSubmittingResponse] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const { data, mutate } = useSWR<{ ticket: Ticket }>(
    `/api/support/tickets/${ticketId}`,
    fetchJson,
    {
      fallbackData: { ticket: initialTicket },
      revalidateOnMount: false,
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      onError: (loadError) => {
        if (loadError instanceof ClientQueryError && loadError.status === 401) {
          router.replace('/login?redirect=/support/tickets');
          return;
        }
        setError(loadError instanceof Error ? loadError.message : 'An error occurred');
      },
    }
  );
  const ticket = data?.ticket ?? initialTicket;
  const canMutateEvidence = ticket.viewerRole === 'owner' || ticket.viewerRole === 'admin' || ticket.viewerRole === 'assignee';

  const handleSubmitResponse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isEmptyRichText(newResponse)) return;
    setSubmittingResponse(true);
    setError('');
    try {
      responseRequestId.current ??= crypto.randomUUID();
      const response = await fetchWithCsrf(`/api/support/tickets/${ticketId}/responses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': responseRequestId.current },
        body: JSON.stringify({ replyHtml: newResponse }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to submit response');
      setNewResponse('');
      responseRequestId.current = null;
      await mutate();
    } catch (responseError) {
      setError(responseError instanceof Error ? responseError.message : 'An error occurred');
    } finally {
      setSubmittingResponse(false);
    }
  };

  const handleUpdateStatus = async (newStatus: string) => {
    setUpdatingStatus(true);
    setError('');
    try {
      const response = await fetchWithCsrf(`/api/support/tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to update status');
      await mutate();
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : 'An error occurred');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const handlePastedImages = async (files: File[]) => {
    if (!canMutateEvidence || files.length === 0) return;
    const form = new FormData();
    for (const file of files) form.append('files', file);
    try {
      const response = await fetchWithCsrf(`/api/support/tickets/${ticketId}/attachments`, { method: 'POST', body: form });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || 'Failed to attach pasted images');
        return;
      }
      await mutate();
    } catch {
      setError('Failed to attach pasted images');
    }
  };

  return (
    <div className="min-h-screen bg-muted/50 py-8 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        <m.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="mb-8">
          <button onClick={() => router.push('/support/tickets')} className="text-muted-foreground hover:text-foreground hover:underline flex items-center gap-2 font-medium">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
            Back to My Tickets
          </button>
        </m.div>
        <PortalPageHeading page="supportTicketDetail" title={ticket.subject} className="mb-6" />
        {error && <div className="mb-6 p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg shadow-sm"><p className="text-red-700 dark:text-red-200 font-medium">{error}</p></div>}
        {evidenceFailed && <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-950/40 border border-yellow-200 dark:border-yellow-900 rounded-lg shadow-sm"><p className="text-yellow-800 text-sm font-medium">Your ticket was created, but some evidence files could not be uploaded. Use the uploader in the Evidence section below to retry.</p></div>}
        <m.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: 'easeOut' }} className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-6">
            <TicketSummary ticket={ticket} />
            <TicketEvidencePanel ticketId={ticketId} canMutateEvidence={canMutateEvidence} />
            <TicketResponses
              ticket={ticket}
              newResponse={newResponse}
              submittingResponse={submittingResponse}
              canMutateEvidence={canMutateEvidence}
              onResponseChange={setNewResponse}
              onSubmit={handleSubmitResponse}
              onImageFiles={(files) => void handlePastedImages(files)}
            />
          </div>
          <TicketDetailSidebar ticket={ticket} updatingStatus={updatingStatus} onUpdateStatus={handleUpdateStatus} />
        </m.div>
      </div>
    </div>
  );
}
