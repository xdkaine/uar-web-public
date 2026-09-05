import { createRoot } from 'react-dom/client';
import CreateSupportTicketClient from '@/app/support/create/CreateSupportTicketClient';
import '@/app/globals.css';

const groups = [{
  dn: 'CN=Support Group,OU=Fixture,DC=example,DC=test',
  name: 'Support Group',
  displayName: 'Support Group',
  path: ['Fixture'],
  containerName: 'Fixture',
}];

createRoot(document.getElementById('root')!).render(
  <main>
    <CreateSupportTicketClient
      requestId="request-&lt;fixture&gt;"
      initialRelatedRequest={{ id: 'request-fixture', name: 'Fixture <Requester>', email: 'fixture@example.test', status: 'approved', isInternal: true, createdAt: '2026-09-04T00:00:00.000Z' }}
      allowedGroups={groups}
      joinableGroups={groups}
      joinWorkflowAvailable
    />
  </main>
);
