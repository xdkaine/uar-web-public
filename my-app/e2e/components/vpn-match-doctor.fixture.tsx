'use client';

import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import VPNADMatchModal from '@/components/admin/VPNADMatchModal';
import '@/app/globals.css';

function VPNMatchDoctorFixture() {
  const [open, setOpen] = useState(true);
  const [importId, setImportId] = useState('synthetic-import');
  useEffect(() => {
    const changeImport = (event: Event) => setImportId((event as CustomEvent<string>).detail);
    window.addEventListener('fixture-import', changeImport);
    return () => window.removeEventListener('fixture-import', changeImport);
  }, []);
  return open ? (
    <VPNADMatchModal importId={importId} onClose={() => setOpen(false)} onComplete={() => {}} />
  ) : <p>Matching closed</p>;
}

createRoot(document.getElementById('root')!).render(<VPNMatchDoctorFixture />);
