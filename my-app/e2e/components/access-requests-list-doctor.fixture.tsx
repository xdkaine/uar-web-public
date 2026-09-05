import { createRoot } from 'react-dom/client';
import AccessRequestsTab from '@/components/admin/AccessRequestsTab';
import '@/app/globals.css';

createRoot(document.getElementById('root')!).render(
  <main className="min-h-screen bg-background p-4 sm:p-8" style={{ boxSizing: 'border-box', width: '100%' }}>
    <AccessRequestsTab />
  </main>,
);
