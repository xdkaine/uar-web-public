import { isModuleEnabled } from '@/lib/modules/core';
import AdminCommunicationsClient from './AdminCommunicationsClient';

export const dynamic = 'force-dynamic';

export default async function AdminCommunicationsPage() {
  const enabled = await isModuleEnabled('communications');
  return <AdminCommunicationsClient disabled={!enabled} />;
}
