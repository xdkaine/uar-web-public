import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionFromCookies } from '@/lib/session';
import ResetPasswordClient from './ResetPasswordClient';

export const metadata: Metadata = {
  title: 'Reset Your Password | User Access Request (UAR) Portal',
};

export default async function ResetPasswordPage() {
  const session = await getSessionFromCookies();
  if (!session) redirect('/forgot-password');
  return <ResetPasswordClient username={session.username} />;
}
