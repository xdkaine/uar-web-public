'use client';

import { useState, useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { fetchWithCsrf } from '@/lib/csrf';

interface Response {
    id: string;
    message: string;
    author: string;
    authorDisplayName?: string;
    isStaff: boolean;
    createdAt: string;
}

interface StatusLog {
    id: string;
    createdAt: string;
    oldStatus: string | null;
    newStatus: string;
    changedBy: string;
    changedByDisplayName?: string;
    isStaff: boolean;
}

interface Ticket {
    id: string;
    subject: string;
    category: string | null;
    severity: string | null;
    body: string;
    status: string;
    username: string;
    displayName?: string;
    createdAt: string;
    updatedAt: string;
    closedAt: string | null;
    closedBy: string | null;
    responses: Response[];
    statusLogs: StatusLog[];
}

export default function AdminTicketDetailPage() {
    const router = useRouter();
    const params = useParams();
    const ticketId = params.id as string;

    const [loading, setLoading] = useState(true);
    const [ticket, setTicket] = useState<Ticket | null>(null);
    const [error, setError] = useState('');
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [newResponse, setNewResponse] = useState('');
    const [submittingResponse, setSubmittingResponse] = useState(false);
    const [updatingStatus, setUpdatingStatus] = useState(false);
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    useEffect(() => {
        document.title = 'Admin - Ticket Details | User Access Request (UAR) Portal';
    }, []);

    useEffect(() => {
        const loadData = async () => {
            try {
                const sessionRes = await fetch('/api/auth/session');
                const sessionData = await sessionRes.json();

                if (!sessionData.isAuthenticated || !sessionData.isAdmin) {
                    router.push('/login?redirect=' + encodeURIComponent(`/admin/support/tickets/${ticketId}`));
                    return;
                }

                setIsAuthenticated(true);

                // Load ticket
                // Admins can use the same endpoint as it allows access to all tickets for admins
                const ticketRes = await fetch(`/api/support/tickets/${ticketId}`);
                const ticketData = await ticketRes.json();

                if (!ticketRes.ok) {
                    throw new Error(ticketData.error || 'Failed to fetch ticket');
                }

                setTicket(ticketData.ticket);
            } catch (err) {
                setError(err instanceof Error ? err.message : 'An error occurred');
            } finally {
                setLoading(false);
            }
        };

        loadData();
    }, [router, ticketId, refreshTrigger]);

    const handleSubmitResponse = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newResponse.trim()) return;

        setSubmittingResponse(true);
        setError('');

        try {
            const response = await fetchWithCsrf(`/api/support/tickets/${ticketId}/responses`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: newResponse }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Failed to submit response');
            }

            setNewResponse('');
            setRefreshTrigger(prev => prev + 1);
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

            setRefreshTrigger(prev => prev + 1);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'An error occurred');
        } finally {
            setUpdatingStatus(false);
        }
    };

    const getSeverityColor = (severity: string | null) => {
        if (!severity) return 'bg-gray-100 text-gray-800';
        switch (severity) {
            case 'critical': return 'bg-red-100 text-red-800';
            case 'high': return 'bg-orange-100 text-orange-800';
            case 'medium': return 'bg-yellow-100 text-yellow-800';
            case 'low': return 'bg-green-100 text-green-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'open': return 'bg-blue-100 text-blue-800';
            case 'in_progress': return 'bg-purple-100 text-purple-800';
            case 'closed': return 'bg-gray-100 text-gray-800';
            default: return 'bg-gray-100 text-gray-800';
        }
    };

    const formatStatus = (status: string) => {
        return status.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
    };

    if (loading) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-black mx-auto"></div>
                    <p className="mt-4 text-gray-600">Loading ticket...</p>
                </div>
            </div>
        );
    }

    if (!isAuthenticated || !ticket) {
        return null;
    }

    return (
        <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6 lg:px-8">
            <div className="max-w-5xl mx-auto">
                <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5 }}
                    className="mb-8"
                >
                    <button
                        onClick={() => router.push('/admin?tab=support')}
                        className="text-gray-600 hover:text-black hover:underline flex items-center gap-2 font-medium"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                        Back to Support Dashboard
                    </button>
                </motion.div>

                {error && (
                    <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg shadow-sm">
                        <p className="text-red-700 font-medium">{error}</p>
                    </div>
                )}

                <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, ease: "easeOut" }}
                    className="grid grid-cols-1 lg:grid-cols-3 gap-6"
                >
                    <div className="lg:col-span-2 space-y-6">

                        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                            <div className="flex flex-col gap-4">
                                <div className="flex justify-between items-start">
                                    <div>
                                        <div className="flex gap-2 mb-3 flex-wrap">
                                            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(ticket.status)}`}>
                                                {formatStatus(ticket.status)}
                                            </span>
                                            {ticket.category && (
                                                <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                                                    {ticket.category}
                                                </span>
                                            )}
                                            {ticket.severity && (
                                                <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${getSeverityColor(ticket.severity)}`}>
                                                    {ticket.severity.toUpperCase()}
                                                </span>
                                            )}
                                        </div>
                                        <h1 className="text-2xl font-bold text-gray-900 mb-2">
                                            {ticket.subject}
                                        </h1>
                                    </div>
                                </div>

                                <div className="border-t border-gray-100 pt-4">
                                    <p className="text-gray-800 whitespace-pre-wrap leading-relaxed">{ticket.body}</p>
                                </div>
                            </div>
                        </div>

                        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                            <h2 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                                Responses
                                <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full text-xs">
                                    {ticket.responses.length}
                                </span>
                            </h2>

                            {ticket.responses.length === 0 ? (
                                <div className="text-center py-8 bg-gray-50 rounded-lg mb-6 border border-dashed border-gray-200">
                                    <p className="text-gray-500">No responses yet.</p>
                                </div>
                            ) : (
                                <div className="space-y-6 mb-8">
                                    {ticket.responses.map((response) => (
                                        <div key={response.id} className="flex gap-4">
                                            <div className="flex-shrink-0 mt-1">
                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${response.isStaff ? 'bg-black text-white' : 'bg-gray-200 text-gray-600'
                                                    }`}>
                                                    {(response.authorDisplayName || response.author).charAt(0).toUpperCase()}
                                                </div>
                                            </div>
                                            <div className="flex-1">
                                                <div className="bg-gray-50 rounded-lg p-4 border border-gray-100">
                                                    <div className="flex justify-between items-start mb-2">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-semibold text-gray-900 text-sm">
                                                                {response.authorDisplayName || response.author}
                                                            </span>
                                                            {response.isStaff && (
                                                                <span className="px-2 py-0.5 bg-black text-white text-[10px] uppercase font-bold tracking-wider rounded">
                                                                    Staff
                                                                </span>
                                                            )}
                                                        </div>
                                                        <span className="text-xs text-gray-500">
                                                            {new Date(response.createdAt).toLocaleString()}
                                                        </span>
                                                    </div>
                                                    <p className="text-gray-800 text-sm whitespace-pre-wrap leading-relaxed">{response.message}</p>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {ticket.status !== 'closed' ? (
                                <form onSubmit={handleSubmitResponse} className="border-t border-gray-100 pt-6">
                                    <label htmlFor="response" className="block text-sm font-medium text-gray-700 mb-2">
                                        Add a Response
                                    </label>
                                    <textarea
                                        id="response"
                                        value={newResponse}
                                        onChange={(e) => setNewResponse(e.target.value)}
                                        rows={4}
                                        className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent bg-white text-gray-900 resize-y min-h-[100px]"
                                        placeholder="Type your response here..."
                                        required
                                    />
                                    <div className="mt-4 flex justify-end">
                                        <button
                                            type="submit"
                                            disabled={submittingResponse || !newResponse.trim()}
                                            className="px-6 py-2 bg-black text-white rounded-md text-sm font-medium hover:bg-gray-800 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed shadow-sm"
                                        >
                                            {submittingResponse ? 'Submitting...' : 'Submit Response'}
                                        </button>
                                    </div>
                                </form>
                            ) : (
                                <div className="border-t border-gray-100 pt-6">
                                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 flex items-center gap-3 text-gray-600">
                                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                        </svg>
                                        <p className="text-sm font-medium">This ticket is closed. Reopen it to add more responses.</p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="space-y-6">
                        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4">
                                Ticket Details
                            </h3>
                            <div className="space-y-4">
                                <div>
                                    <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Ticket ID</div>
                                    <div className="font-mono text-sm bg-gray-100 px-2 py-1 rounded inline-block text-gray-700">
                                        {ticket.id.slice(0, 8)}
                                    </div>
                                </div>
                                <div>
                                    <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Reported By</div>
                                    <div className="text-sm font-medium text-gray-900">{ticket.displayName || ticket.username}</div>
                                    <div className="text-xs text-gray-500">{ticket.username}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Created</div>
                                    <div className="text-sm text-gray-900">{new Date(ticket.createdAt).toLocaleString()}</div>
                                </div>
                                <div>
                                    <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Last Updated</div>
                                    <div className="text-sm text-gray-900">{new Date(ticket.updatedAt).toLocaleString()}</div>
                                </div>
                                {ticket.closedAt && (
                                    <div>
                                        <div className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">Closed</div>
                                        <div className="text-sm text-gray-900">{new Date(ticket.closedAt).toLocaleString()}</div>
                                        {ticket.closedBy && (
                                            <div className="text-xs text-gray-500">by {ticket.closedBy}</div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div className="mt-6 pt-6 border-t border-gray-100 space-y-3">
                                {ticket.status !== 'closed' && (
                                    <>
                                        {ticket.status !== 'in_progress' && (
                                            <button
                                                onClick={() => handleUpdateStatus('in_progress')}
                                                disabled={updatingStatus}
                                                className="w-full px-4 py-2 bg-purple-600 text-white rounded-md text-sm font-medium hover:bg-purple-700 transition-colors disabled:bg-purple-400"
                                            >
                                                {updatingStatus ? 'Updating...' : 'Mark In Progress'}
                                            </button>
                                        )}
                                        <button
                                            onClick={() => handleUpdateStatus('closed')}
                                            disabled={updatingStatus}
                                            className="w-full px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors disabled:bg-gray-100"
                                        >
                                            {updatingStatus ? 'Closing...' : 'Close Ticket'}
                                        </button>
                                    </>
                                )}
                                {ticket.status === 'closed' && (
                                    <button
                                        onClick={() => handleUpdateStatus('open')}
                                        disabled={updatingStatus}
                                        className="w-full px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 transition-colors disabled:bg-blue-400"
                                    >
                                        {updatingStatus ? 'Reopening...' : 'Reopen Ticket'}
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
                            <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-4">
                                History
                            </h3>

                            {!ticket.statusLogs || ticket.statusLogs.length === 0 ? (
                                <p className="text-sm text-gray-500">No history available.</p>
                            ) : (
                                <div className="relative border-l-2 border-gray-100 ml-2 space-y-6">
                                    {ticket.statusLogs.map((log) => (
                                        <div key={log.id} className="relative pl-6">
                                            <div className="absolute -left-[5px] top-1.5 w-2.5 h-2.5 rounded-full bg-gray-300 border-2 border-white"></div>
                                            <div className="text-sm">
                                                <span className="font-semibold text-gray-900">
                                                    {log.changedByDisplayName || log.changedBy}
                                                </span>
                                                <div className="text-xs text-gray-500 mb-1">
                                                    {new Date(log.createdAt).toLocaleString()}
                                                </div>
                                                <p className="text-gray-700 text-xs">
                                                    {log.oldStatus ? (
                                                        <>
                                                            Changed from <span className="font-medium">{formatStatus(log.oldStatus)}</span> to <span className="font-medium">{formatStatus(log.newStatus)}</span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            Created as <span className="font-medium">{formatStatus(log.newStatus)}</span>
                                                        </>
                                                    )}
                                                </p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </motion.div>
            </div>
        </div>
    );
}
