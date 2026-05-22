import { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { checkAdminAuth } from '@/lib/adminAuth';

interface AdminLayoutProps {
  children: ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const admin = await checkAdminAuth();

  if (!admin) {
    redirect('/login?redirect=/admin');
  }

  return <>{children}</>;
}
