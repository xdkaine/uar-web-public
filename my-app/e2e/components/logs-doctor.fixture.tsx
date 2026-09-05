import { createRoot } from 'react-dom/client';
import LogsTab from '@/components/admin/LogsTab';
import '@/app/globals.css';

createRoot(document.getElementById('root')!).render(
  <main className="min-h-screen bg-background p-4 sm:p-8"><LogsTab isLoading={false} /></main>,
);
