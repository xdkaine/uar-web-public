import { createRoot } from 'react-dom/client';
import ModulesPanel from '@/components/admin/config/ModulesPanel';
import PrivilegesPanel from '@/components/admin/config/PrivilegesPanel';
import DirectoryEmailPanel from '@/components/admin/config/DirectoryEmailPanel';
import '@/app/globals.css';

createRoot(document.getElementById('root')!).render(
  <main className="min-h-screen bg-background p-4 sm:p-8 space-y-8">
    <ModulesPanel />
    <PrivilegesPanel />
    <DirectoryEmailPanel />
  </main>
);
