'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { ClientLocalDate } from '@/components/admin/ClientLocalDate';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/useToast';

interface RequestDetail {
  id: string; name: string; email: string; isInternal: boolean; needsDomainAccount: boolean; isVerified: boolean; status: string; createdAt: string; updatedAt: string;
  ldapUsername?: string; hasPassword?: boolean; accountCreatedAt?: string; accountExpiresAt?: string; linkedAdUsername?: string; isManuallyAssigned?: boolean; isGrandfatheredAccount?: boolean;
  institution?: string; eventReason?: string; eventId?: string; event?: { id: string; name: string; endDate?: string; description?: string };
  rejectionReason?: string; provisioningState?: string; provisioningError?: string; provisioningCompletedAt?: string; version?: number;
}

interface RequestDetailModalProps { requestId: string; onClose: () => void; }

function InfoRow({ label, value, highlight = false }: { label: string; value?: ReactNode; highlight?: boolean }) {
  return <div className="grid gap-1 border-b border-border py-3 last:border-b-0 sm:grid-cols-[minmax(10rem,0.38fr)_1fr] sm:gap-5"><dt className="font-semibold text-muted-foreground">{label}</dt><dd className={`${highlight ? 'font-bold text-foreground' : 'text-foreground'} min-w-0 break-words`}>{value || 'N/A'}</dd></div>;
}

function getStatusColor(status: string) {
  const colors: Record<string, string> = {
    pending_verification: 'bg-muted text-foreground border-border',
    pending_student_directors: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900',
    pending_faculty: 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-950/40 dark:text-yellow-200 dark:border-yellow-900',
    approved: 'bg-green-100 text-green-800 border-green-300 dark:bg-green-950/40 dark:text-green-200 dark:border-green-900',
    rejected: 'bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900',
    offboarded: 'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-900/40 dark:text-slate-200 dark:border-slate-700',
  };
  return colors[status] || 'bg-muted text-foreground border-border';
}

function formatDate(date?: string) {
  return date ? <ClientLocalDate value={date} includeSeconds /> : 'N/A';
}

interface RequestDetailResponse {
  request?: RequestDetail;
  review?: { currentStage?: { label?: string } };
}

async function fetchRequestDetail(url: string): Promise<RequestDetailResponse> {
  const response = await fetch(url);
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to fetch request details');
  }
  const data = await response.json();
  return data.request ? data : { request: data };
}

function useRequestDetail(requestId: string, notify: (message: string, type: 'error') => void) {
  const { data, isLoading } = useSWR(`/api/admin/requests/${requestId}`, fetchRequestDetail, {
    onError: error => {
      console.error('Error fetching request details:', error);
      notify(error instanceof Error ? error.message : 'Failed to load request details', 'error');
    },
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  return { loading: isLoading, request: data?.request ?? null, reviewLabel: data?.review?.currentStage?.label ?? null };
}

function RequestLoadingDialog({ onClose }: { onClose: () => void }) {
  return <Dialog open onOpenChange={open => !open && onClose()}><DialogContent><DialogHeader><DialogTitle>Loading...</DialogTitle></DialogHeader><div className="flex items-center justify-center py-12"><div className="h-12 w-12 animate-spin rounded-full border-b-2 border-foreground" /></div></DialogContent></Dialog>;
}

function RequestNotFoundDialog({ onClose }: { onClose: () => void }) {
  return <Dialog open onOpenChange={open => !open && onClose()}><DialogContent><DialogHeader><DialogTitle>Error</DialogTitle></DialogHeader><div className="py-8 text-center"><p className="text-muted-foreground">Request not found</p></div></DialogContent></Dialog>;
}

function RequestSummary({ request, reviewLabel }: { request: RequestDetail; reviewLabel: string | null }) {
  const requestType = request.isInternal ? 'Internal Student' : 'External Visitor';
  const markerClass = request.isInternal ? 'bg-blue-500' : 'bg-purple-500';
  return <div className="mx-6 mt-6 rounded-xl border border-blue-200 bg-blue-50 p-5 dark:border-blue-900 dark:bg-blue-950/40"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0"><h3 className="mb-2 text-2xl font-bold text-foreground">{request.name}</h3><p className="break-words text-lg text-foreground">{request.email}</p></div><span className={`w-fit shrink-0 rounded-full border px-3 py-1.5 text-sm font-bold ${getStatusColor(request.status)}`}>{(reviewLabel || request.status.replace(/_/g, ' ')).toUpperCase()}</span></div><div className="mt-5 grid gap-4 border-t border-blue-200 pt-4 dark:border-blue-900 md:grid-cols-2"><div><span className="text-sm font-semibold text-muted-foreground">Type</span><p className="text-lg font-bold text-foreground"><span className="inline-flex items-center gap-2"><span className={`h-3 w-3 rounded-full ${markerClass}`} />{requestType}</span></p></div><div><span className="text-sm font-semibold text-muted-foreground">Request ID</span><p className="break-all font-mono text-sm text-foreground">{request.id}</p></div></div></div>;
}

function RequestTabs({ activeTab, onChange }: { activeTab: 'overview' | 'technical'; onChange: (tab: 'overview' | 'technical') => void }) {
  return <div className="mt-5 shrink-0 border-b border-border px-6"><nav className="flex gap-4"><button onClick={() => onChange('overview')} className={`border-b-2 px-4 py-2 font-semibold transition-colors ${activeTab === 'overview' ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>Overview</button><button onClick={() => onChange('technical')} className={`border-b-2 px-4 py-2 font-semibold transition-colors ${activeTab === 'technical' ? 'border-blue-600 text-blue-600 dark:border-blue-400 dark:text-blue-400' : 'border-transparent text-muted-foreground hover:text-foreground'}`}>Technical Details</button></nav></div>;
}

function BasicInformationCard({ request }: { request: RequestDetail }) {
  return <div className="rounded-lg border-2 border-border bg-card p-6"><h4 className="mb-4 text-lg font-bold text-foreground">Basic Information</h4><dl className="space-y-0"><InfoRow label="Full Name" value={request.name} highlight /><InfoRow label="Email Address" value={request.email} highlight /><InfoRow label="Request Type" value={request.isInternal ? 'Internal Student' : 'External Visitor'} /><InfoRow label="Email Verified" value={request.isVerified ? 'Yes' : 'No'} />{request.institution && <InfoRow label="Institution" value={request.institution} />}</dl></div>;
}

function EventInformationCard({ request }: { request: RequestDetail }) {
  return <div className="rounded-lg border-2 border-border bg-card p-6"><h4 className="mb-4 text-lg font-bold text-foreground">Event Information</h4><dl className="space-y-0"><InfoRow label="Event Name" value={request.event?.name || request.eventReason} />{request.event?.description && <InfoRow label="Description" value={request.event.description} />}{request.event?.endDate && <InfoRow label="End Date" value={formatDate(request.event.endDate)} />}</dl></div>;
}

function DomainAccountCard({ request }: { request: RequestDetail }) {
  return <div className="rounded-lg border-2 border-border bg-card p-6"><h4 className="mb-4 text-lg font-bold text-foreground">Domain Account</h4><dl className="space-y-0"><InfoRow label="Username" value={request.ldapUsername} highlight /><InfoRow label="Password Status" value={request.hasPassword ? 'Stored securely' : 'Not set'} />{request.accountCreatedAt && <InfoRow label="Account Created" value={formatDate(request.accountCreatedAt)} />}{request.accountExpiresAt && <InfoRow label="Account Expires" value={formatDate(request.accountExpiresAt)} />}{request.provisioningState && <InfoRow label="Provisioning State" value={request.provisioningState} />}</dl></div>;
}

function LinkedAccountCard({ request }: { request: RequestDetail }) {
  return <div className="rounded-lg border-2 border-border bg-card p-6"><h4 className="mb-4 text-lg font-bold text-foreground">Linked Account</h4><dl className="space-y-0"><InfoRow label="AD Username" value={request.linkedAdUsername} highlight /><InfoRow label="Manually Assigned" value={request.isManuallyAssigned ? 'Yes' : 'No'} /><InfoRow label="Grandfathered" value={request.isGrandfatheredAccount ? 'Yes' : 'No'} /></dl></div>;
}

function RequestOverview({ request }: { request: RequestDetail }) {
  return <div className="space-y-6"><BasicInformationCard request={request} />{(request.event || request.eventReason) && <EventInformationCard request={request} />}{request.isInternal && request.needsDomainAccount && <DomainAccountCard request={request} />}{!request.isInternal && request.linkedAdUsername && <LinkedAccountCard request={request} />}{request.status === 'rejected' && request.rejectionReason && <div className="rounded-lg border-2 border-red-200 bg-red-50 p-6 dark:border-red-900 dark:bg-red-950/40"><h4 className="mb-4 text-lg font-bold text-red-900 dark:text-red-200">Rejection Reason</h4><p className="whitespace-pre-wrap text-red-900 dark:text-red-200">{request.rejectionReason}</p></div>}</div>;
}

function RequestTechnical({ request }: { request: RequestDetail }) {
  return <div className="space-y-6"><div className="rounded-lg border-2 border-border bg-card p-6"><h4 className="mb-4 text-lg font-bold text-foreground">System Information</h4><dl className="space-y-0"><InfoRow label="Request ID" value={<span className="break-all font-mono text-xs">{request.id}</span>} /><InfoRow label="Version" value={request.version} /><InfoRow label="Created At" value={formatDate(request.createdAt)} /><InfoRow label="Updated At" value={formatDate(request.updatedAt)} /></dl></div>{request.provisioningState && <div className="rounded-lg border-2 border-border bg-card p-6"><h4 className="mb-4 text-lg font-bold text-foreground">Provisioning Details</h4><dl className="space-y-0"><InfoRow label="State" value={request.provisioningState} />{request.provisioningCompletedAt && <InfoRow label="Completed At" value={formatDate(request.provisioningCompletedAt)} />}{request.provisioningError && <InfoRow label="Error" value={<span className="break-all text-sm text-red-600 dark:text-red-400">{request.provisioningError}</span>} />}</dl></div>}{request.eventId && <div className="rounded-lg border-2 border-border bg-card p-6"><h4 className="mb-4 text-lg font-bold text-foreground">Event Association</h4><dl className="space-y-0"><InfoRow label="Event ID" value={<span className="break-all font-mono text-xs">{request.eventId}</span>} /><InfoRow label="Event Name" value={request.event?.name} /></dl></div>}</div>;
}

export default function RequestDetailModal({ requestId, onClose }: RequestDetailModalProps) {
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<'overview' | 'technical'>('overview');
  const { loading, request, reviewLabel } = useRequestDetail(requestId, showToast);
  if (loading) return <RequestLoadingDialog onClose={onClose} />;
  if (!request) return <RequestNotFoundDialog onClose={onClose} />;
  return <Dialog open onOpenChange={open => !open && onClose()}><DialogContent size="wide" className="gap-0 overflow-hidden p-0"><DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-14"><DialogTitle className="text-xl">Access request details</DialogTitle></DialogHeader><div className="flex min-h-0 flex-col"><RequestSummary request={request} reviewLabel={reviewLabel} /><RequestTabs activeTab={activeTab} onChange={setActiveTab} /><div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{activeTab === 'overview' ? <RequestOverview request={request} /> : <RequestTechnical request={request} />}</div><div className="flex shrink-0 flex-col-reverse gap-3 border-t border-border bg-muted/25 px-6 py-4 sm:flex-row sm:justify-end"><button onClick={onClose} className="rounded-lg bg-muted px-6 py-2 font-semibold text-foreground transition-colors hover:bg-border">Close</button><Link href={`/admin/requests/${request.id}`} className="rounded-lg bg-blue-600 px-6 py-2 text-center font-semibold text-white transition-colors hover:bg-blue-700">Open full request</Link></div></div></DialogContent></Dialog>;
}
