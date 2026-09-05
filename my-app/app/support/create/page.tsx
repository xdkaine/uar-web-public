import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextRequest } from 'next/server';

import { GET as getRequest } from '@/app/api/admin/requests/[id]/route';
import { GET as getAllowedGroups } from '@/app/api/support/tickets/allowed-groups/route';
import { LazyMotionBoundary } from '@/components/animations/LazyMotionBoundary';
import { getSessionFromCookies } from '@/lib/session';

import CreateSupportTicketClient, {
  type AccessRequest,
  type AllowedGroup,
} from './CreateSupportTicketClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Create Support Ticket | User Access Request (UAR) Portal',
};

interface CreateSupportTicketPageProps {
  searchParams: Promise<{ requestId?: string | string[] }>;
}

export default async function CreateSupportTicketPage({ searchParams }: CreateSupportTicketPageProps) {
  const query = await searchParams;
  const requestId = typeof query.requestId === 'string' ? query.requestId : null;
  const currentUrl = `/support/create${requestId ? `?requestId=${encodeURIComponent(requestId)}` : ''}`;
  const session = await getSessionFromCookies();
  if (!session) {
    redirect(`/login?redirect=${encodeURIComponent(currentUrl)}`);
  }

  const groupsResponse = await getAllowedGroups();
  if (groupsResponse.status === 401) {
    redirect(`/login?redirect=${encodeURIComponent(currentUrl)}`);
  }
  const groupsBody = groupsResponse.ok
    ? await groupsResponse.json() as {
        groups?: AllowedGroup[];
        joinableGroups?: AllowedGroup[];
        groupJoinWorkflowAvailable?: boolean;
      }
    : {};

  let initialRelatedRequest: AccessRequest | null = null;
  if (requestId && session.isAdmin) {
    const requestResponse = await getRequest(
      new NextRequest(`http://uar.internal/api/admin/requests/${encodeURIComponent(requestId)}`, {
        headers: new Headers(await headers()),
      }),
      { params: Promise.resolve({ id: requestId }) }
    );
    if (requestResponse.ok) {
      const requestBody = await requestResponse.json() as { request?: AccessRequest };
      initialRelatedRequest = requestBody.request ?? null;
    }
  }

  return (
    <LazyMotionBoundary>
      <CreateSupportTicketClient
        requestId={requestId}
        initialRelatedRequest={initialRelatedRequest}
        allowedGroups={groupsBody.groups ?? []}
        joinableGroups={groupsBody.joinableGroups ?? []}
        joinWorkflowAvailable={groupsBody.groupJoinWorkflowAvailable === true}
      />
    </LazyMotionBoundary>
  );
}
