import { createRoot } from 'react-dom/client';
import { useState } from 'react';

import RequestDetailMetadata from '@/app/admin/requests/[id]/RequestDetailMetadata';
import '@/app/globals.css';

const request = {
  id: 'request-42', version: 7, createdAt: '2026-09-04T08:30:00.000Z', updatedAt: '2026-09-04T08:35:00.000Z',
  name: 'Taylor Example', email: 'taylor@example.test', isInternal: false, needsDomainAccount: true,
  institution: 'Example Institute', eventReason: 'Conference access', accessEndTime: '2026-09-10T17:00:00.000Z',
  isVerified: true, status: 'approved', acknowledgedByDirector: true, acknowledgedAt: '2026-09-04T09:00:00.000Z',
  acknowledgedBy: 'director@example.test', approvedAt: '2026-09-04T10:00:00.000Z', approvedBy: 'faculty@example.test',
  ldapUsername: 'texample', vpnUsername: 'texample-vpn', accountExpiresAt: '2026-09-10T17:00:00.000Z',
};

function AccessRequestDoctorFixture() {
  const [attempts, setAttempts] = useState(0);
  return (
    <main className="mx-auto max-w-4xl p-4">
      <h1>Access Request Details</h1>
      <p>Request version: {request.version}</p>
      <p>Current review stage: Faculty Review</p>
      <RequestDetailMetadata request={request} actorDisplayNames={{ 'director@example.test': 'Director Example', 'faculty@example.test': 'Faculty Example' }} />
      <button type="button" onClick={() => setAttempts((value) => value + 1)}>Retry local request</button>
      <p>Retries: {attempts}</p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<AccessRequestDoctorFixture />);
