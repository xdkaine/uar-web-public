import { redirect } from 'next/navigation';

/**
 * Preserve old bookmarks while keeping one governed batch-account workflow.
 */
export default function LegacyBatchAccountsPage() {
  redirect('/admin/batch');
}
