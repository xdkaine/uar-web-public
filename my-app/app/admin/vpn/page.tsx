import { isModuleEnabled } from '@/lib/modules/core';
import AdminVpnClient from './AdminVpnClient';

export const dynamic = 'force-dynamic';

export default async function AdminVpnPage() {
  const enabled = await isModuleEnabled('vpn.management');
  return <AdminVpnClient disabled={!enabled} />;
}
