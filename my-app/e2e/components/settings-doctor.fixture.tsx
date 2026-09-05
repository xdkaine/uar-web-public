import { createRoot } from 'react-dom/client';
import SystemSettingsNotifications from '@/components/admin/SystemSettingsNotifications';
import '@/app/globals.css';

createRoot(document.getElementById('root')!).render(
  <main className="min-h-screen bg-background p-4 sm:p-8">
    <SystemSettingsNotifications />
  </main>
);
