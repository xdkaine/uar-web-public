import { redirect } from 'next/navigation';

export default function AdminActionHistoryPage() {
  redirect('/admin/logs?view=history');
}
