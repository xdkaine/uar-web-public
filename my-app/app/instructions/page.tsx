import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { GET as getProfile } from '@/app/api/profile/route';
import InstructionsClient from './InstructionsClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'VPN Setup Instructions | User Access Request (UAR) Portal',
};

export default async function InstructionsPage() {
  const profileResponse = await getProfile();
  if (!profileResponse.ok) redirect('/login');
  return <InstructionsClient />;
}
