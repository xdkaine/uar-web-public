import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import CommunicationsTab from '@/components/admin/CommunicationsTab';
import '@/app/globals.css';

function Fixture() {
  const [mounted, setMounted] = useState(true);
  return (
    <main className="min-h-screen bg-background p-4 sm:p-8">
      <button type="button" className="sr-only" onClick={() => setMounted(false)}>Unmount fixture</button>
      {mounted ? <CommunicationsTab /> : <p>Communications fixture unmounted</p>}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
