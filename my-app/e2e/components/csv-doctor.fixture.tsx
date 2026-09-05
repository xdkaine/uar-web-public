import { createRoot } from 'react-dom/client';

import SupportTicketsTab from '@/components/admin/SupportTicketsTab';
import UserManagementTab from '@/components/admin/UserManagementTab';
import VPNManagementTab from '@/components/admin/VPNManagementTab';
import '@/app/globals.css';

const timestamp = '2026-09-04T00:00:00.000Z';
const vpnAccountCount = new URLSearchParams(window.location.search).has('vpnMany') ? 26 : 1;

createRoot(document.getElementById('root')!).render(
  <main>
    <section id="support-csv"><SupportTicketsTab isLoading={false} tickets={[{
      id: 'support-fixture', subject: 'CSV support fixture', category: 'account_issue', severity: 'high', body: '<p>Support CSV body</p>', status: 'open', username: 'support.fixture', displayName: 'Support Fixture', createdAt: timestamp, updatedAt: timestamp, closedAt: null, closedBy: null, responses: [], statusLogs: [], assignees: ['Network Team'], attachmentCount: 0,
    }]} /></section>
    <section id="users-csv"><UserManagementTab isLoading={false} users={[{
      dn: 'CN=User,OU=Fixture,DC=example,DC=test', username: 'user.fixture', displayName: 'User Fixture', email: 'user@example.test', description: 'CSV user fixture', accountEnabled: true, accountExpires: null, whenCreated: timestamp, memberOf: ['CN=Fixture Group,DC=example,DC=test'], lastVerifiedAt: timestamp, lastVerifiedSource: 'directory',
    }]} /></section>
    <section id="vpn-csv"><VPNManagementTab isLoading={false} accounts={Array.from({ length: vpnAccountCount }, (_, index) => ({
      id: `vpn-fixture-${index}`, username: `vpn.fixture.${index}`, name: 'VPN Fixture', email: 'vpn@example.test', portalType: 'Management', isInternal: true, status: 'active', createdAt: timestamp, createdBy: 'fixture.staff', createdByFaculty: true,
    }))} /></section>
  </main>
);
