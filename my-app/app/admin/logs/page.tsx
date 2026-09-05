import LogsTab from '@/components/admin/LogsTab';
import AdminPageHeader from '@/components/admin/AdminPageHeader';
import { AdminRoutePage } from '@/components/admin/AdminRoutePage';

interface AdminLogsPageProps {
  searchParams: Promise<{ view?: string | string[] }>;
}

export default async function AdminLogsPage({ searchParams }: AdminLogsPageProps) {
  const params = await searchParams;
  const requestedView = Array.isArray(params.view) ? params.view[0] : params.view;
  const initialView = requestedView === 'history' ? 'history' : 'audit';
  return (
    <AdminRoutePage title="Audit & Action History" tabId="logs" category="logs">
      <AdminPageHeader
        title="Audit & Action History"
        description="One activity surface for immutable audit evidence and account-centered history."
      />
      <LogsTab isLoading={false} initialView={initialView} />
    </AdminRoutePage>
  );
}
