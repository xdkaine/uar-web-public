import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import ActivateAccountClient from './ActivateAccountClient';

export const metadata: Metadata = {
  title: 'Activate Account | User Access Request (UAR) Portal',
};

export default async function ActivateAccountPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  if (!token) redirect('/account/activate/expired');
  return <ActivateAccountClient token={token} />;
}
