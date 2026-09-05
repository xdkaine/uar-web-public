import { createRoot } from 'react-dom/client';
import { useState } from 'react';

import RequestDetailModal from '@/components/admin/RequestDetailModal';
import '@/app/globals.css';

function RequestDetailDoctorFixture() {
  const [requestId, setRequestId] = useState('old-request');
  const [mounted, setMounted] = useState(true);

  return (
    <main>
      <div className="flex gap-2">
        <button onClick={() => setRequestId('stale-request')}>Load stale request</button>
        <button onClick={() => setRequestId('wrapped-request')}>Load wrapped request</button>
        <button onClick={() => setRequestId('direct-request')}>Load direct request</button>
        <button onClick={() => setRequestId('unmount-request')}>Load unmount request</button>
        <button onClick={() => setMounted(false)}>Unmount modal</button>
      </div>
      {mounted && <RequestDetailModal requestId={requestId} onClose={() => undefined} />}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<RequestDetailDoctorFixture />);
