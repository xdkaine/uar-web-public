'use client';

import { useState, useRef, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import * as m from 'framer-motion/m';
import { fetchWithCsrf } from '@/lib/csrf';
import { isEmptyRichText } from '@/lib/ticket-content';
import { ClientQueryError, fetchJson } from '@/lib/client-query';
import { AdminTicketResponses } from './AdminTicketResponses';
import { AdminTicketSidebar } from './AdminTicketSidebar';
import { AdminTicketSummary } from './AdminTicketSummary';
import type { Ticket } from './AdminTicketTypes';

export type { Ticket } from './AdminTicketTypes';

interface AdminTicketDetailClientProps {
    initialTicket: Ticket;
    ticketId: string;
}

export default function AdminTicketDetailClient({ initialTicket, ticketId }: AdminTicketDetailClientProps) {
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
                if (loadError instanceof ClientQueryError && [401, 403].includes(loadError.status)) {
                    router.replace('/login?redirect=' + encodeURIComponent(`/admin/support/tickets/${ticketId}`));
                    return;
                }
                setError(loadError instanceof Error ? loadError.message : 'An error occurred');
            },
        }
    );
    const ticket = data?.ticket ?? initialTicket;

    const handleSubmitResponse = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        if (isEmptyRichText(newResponse)) return;

        setSubmittingResponse(true);
        setError('');

        try {
            responseRequestId.current ??= crypto.randomUUID();
            const response = await fetchWithCsrf(`/api/support/tickets/${ticketId}/responses`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': responseRequestId.current },
                body: JSON.stringify({ bodyHtml: newResponse }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to submit response');
            }

            setNewResponse('');
            responseRequestId.current = null;
            await mutate();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
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

            if (!response.ok) {
                throw new Error(data.error || 'Failed to update status');
            }

            await mutate();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setUpdatingStatus(false);
        }
    };


    return (
        <div className="min-h-screen bg-background py-8 px-4 sm:px-6 lg:px-8">
            <div className="mx-auto w-full max-w-[1700px]">
                <m.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="mb-8"
                >
                    <button
                        onClick={() => router.push('/admin?tab=support')}
                        className="text-muted-foreground hover:text-foreground hover:underline flex items-center gap-2 font-medium"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        Back to Support Dashboard
                    </button>
                </m.div>

                {error && (
                    <div className="mb-6 p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg shadow-sm">
                        <p className="text-red-700 dark:text-red-200 font-medium">{error}</p>
                    </div>
                )}

                <m.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className="grid grid-cols-1 lg:grid-cols-3 gap-6"
                >
                    <div className="lg:col-span-2 space-y-6">

                        <AdminTicketSummary ticket={ticket} />

                        <AdminTicketResponses
                            ticket={ticket}
                            newResponse={newResponse}
                            submittingResponse={submittingResponse}
                            onResponseChange={setNewResponse}
                            onSubmit={handleSubmitResponse}
                        />

                    </div>

                    <AdminTicketSidebar ticket={ticket} updatingStatus={updatingStatus} onUpdateStatus={handleUpdateStatus} />
                </m.div>
            </div>
        </div>
    );
}
