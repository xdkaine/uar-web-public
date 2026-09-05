import { createRoot } from 'react-dom/client';
import { useState } from 'react';

import TicketsClient, { type Ticket } from '@/app/support/tickets/TicketsClient';
import '@/app/globals.css';

function TicketsListDoctorFixture() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loadError, setLoadError] = useState('');
  const [loading, setLoading] = useState(false);
  const isEmptyFixture = new URLSearchParams(window.location.search).has('empty');

  const loadTickets = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/tickets-list-doctor');
      const body = await response.json() as { error?: string; tickets?: Ticket[] };
      if (!response.ok) throw new Error(body.error ?? 'Fixture ticket list failed.');
      setTickets(body.tickets ?? []);
      setLoadError('');
    } catch (error) {
      setTickets([]);
      setLoadError(error instanceof Error ? error.message : 'Fixture ticket list failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main>
      {!isEmptyFixture && !loading && !loadError && tickets.length === 0 && (
        <button type="button" onClick={() => void loadTickets()}>Load ticket list</button>
      )}
      {loading && <p>Loading tickets…</p>}
      {loadError && <button type="button" onClick={() => void loadTickets()}>Retry ticket list</button>}
      <TicketsClient tickets={tickets} loadError={loadError} />
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<TicketsListDoctorFixture />);
