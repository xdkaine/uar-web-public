import { createRoot } from 'react-dom/client';

import AdminTicketDetailClient, { type Ticket } from '@/app/admin/support/tickets/[id]/AdminTicketDetailClient';
import '@/app/globals.css';

const ticket: Ticket = {
  id: 'admin-ticket-fixture',
  subject: 'Admin fixture ticket <subject>',
  category: 'account_issue',
  severity: 'high',
  body: '<p>Fixture ticket body with <strong>safe content</strong>.</p>',
  status: 'open',
  username: 'fixture.requester',
  displayName: 'Fixture Requester',
  createdAt: '2026-09-04T00:00:00.000Z',
  updatedAt: '2026-09-04T01:00:00.000Z',
  closedAt: null,
  closedBy: null,
  assignees: ['Network Team'],
  requestedForGroupDn: 'CN=Network Team,OU=Groups,DC=example,DC=test',
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
    changedBy: 'fixture.staff',
    changedByDisplayName: 'Fixture Staff',
    isStaff: true,
  }],
};

createRoot(document.getElementById('root')!).render(
  <main>
    <AdminTicketDetailClient initialTicket={ticket} ticketId={ticket.id} />
  </main>
);
