'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import BatchAccountsTab, { type BatchCreation } from '@/components/admin/BatchAccountsTab';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { AdminRoutePage } from '@/components/admin/AdminRoutePage';

interface SupportTicket {
  id: string;
  subject: string;
  status: string;
}

export default function AdminBatchPage() {
  const [batches, setBatches] = useState<BatchCreation[]>([]);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);

  const fetchBatches = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/batch-accounts');
      if (!response.ok) throw new Error('Failed to fetch batches');
      const data = await response.json();
      setBatches(data.batches || []);
    } catch (error) {
      console.error('Error fetching batches:', error);
    }
  }, []);

  const fetchSupportTickets = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/support/tickets');
      if (!response.ok) throw new Error('Failed to fetch support tickets');
      const data = await response.json();
      setSupportTickets(data.tickets || []);
    } catch (error) {
      console.error('Error fetching support tickets:', error);
    }
  }, []);

  useEffect(() => {
    fetchBatches();
    fetchSupportTickets();
  }, [fetchBatches, fetchSupportTickets]);

  return (
    <AdminRoutePage title="Batch Accounts" tabId="batch" category="batch">
      <AdminPageHeader
        title="Batch Accounts"
        description="Create accounts in bulk and track batch progress."
        actions={
          <button
            type="button"
            onClick={fetchBatches}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Refresh
          </button>
        }
      />
      <Suspense fallback={<p className="text-sm text-muted-foreground">Loading batch accounts…</p>}>
        <BatchAccountsTab
          batches={batches}
          supportTickets={supportTickets.filter(
            (ticket) => ticket.status === 'open' || ticket.status === 'in-progress'
          )}
          onBatchCreated={fetchBatches}
        />
      </Suspense>
    </AdminRoutePage>
  );
}
