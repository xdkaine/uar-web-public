import { createRoot } from 'react-dom/client';

import TicketDetailClient from '@/app/support/tickets/[id]/TicketDetailClient';
import type { Ticket } from '@/app/support/tickets/[id]/TicketDetailTypes';
import '@/app/globals.css';

const ticket: Ticket = {
  id: 'ticket-fixture',
  subject: 'Fixture ticket <subject>',
  category: 'account_issue',
  severity: 'medium',
  body: '<p>Fixture ticket body with <strong>safe content</strong>.</p>',
  status: 'open',
  username: 'fixture.requester',
  displayName: 'Fixture Requester',
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T01:00:00.000Z',
  closedAt: null,
  closedBy: null,
  viewerRole: 'owner',
  responses: [{
    id: 'response-existing',
    message: '<p>Existing staff response.</p>',
    author: 'fixture.staff',
    authorDisplayName: 'Fixture Staff',
    isStaff: true,
    createdAt: '2026-09-04T01:00:00.000Z',
  }],
  statusLogs: [{
    id: 'history-created',
    createdAt: '2026-09-04T00:00:00.000Z',
    oldStatus: null,
    newStatus: 'open',
    changedBy: 'fixture.requester',
    changedByDisplayName: 'Fixture Requester',
    isStaff: false,
  }],
};

createRoot(document.getElementById('root')!).render(
  <main>
    <TicketDetailClient initialTicket={ticket} ticketId={ticket.id} evidenceFailed />
  </main>
);
