import { ReactNode, Suspense } from 'react';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { checkAdminAuth } from '@/lib/adminAuth';
import AdminShell from '@/components/admin/AdminShell';
import { canAccessAdminRoute } from '@/lib/admin/navigation';
import { getSessionFromCookies } from '@/lib/session';

interface AdminLayoutProps {
  children: ReactNode;
}

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const admin = await checkAdminAuth();

  if (!admin) {
    const session = await getSessionFromCookies();
    if (!session) {
      redirect('/login?redirect=/admin');
    }

    return (
      <section className="mx-auto flex min-h-screen w-full max-w-2xl items-center px-6 py-12" aria-label="Admin access denied">
        <div role="alert" className="w-full rounded-xl border border-destructive/30 bg-destructive/5 p-6">
          <h1 className="text-lg font-semibold text-foreground">You do not have access to this admin area.</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your signed-in account has no administrative capabilities. Contact an administrator if you believe this is incorrect.
          </p>
        </div>
      </section>
    );
  }

  const requestHeaders = await headers();
  const pathname = requestHeaders.get('x-uar-admin-pathname');

  if (!pathname || !canAccessAdminRoute(pathname, admin.permissions)) {
    return (
      <section className="mx-auto flex min-h-screen w-full max-w-2xl items-center px-6 py-12" aria-label="Admin access denied">
        <div role="alert" className="w-full rounded-xl border border-destructive/30 bg-destructive/5 p-6">
          <h1 className="text-lg font-semibold text-foreground">You do not have access to this admin area.</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Your assigned privileges do not include the requested capability. Use the Admin Console to open an available area.
          </p>
        </div>
      </section>
    );
  }

  return (
    <Suspense fallback={children}>
      <AdminShell>{children}</AdminShell>
    </Suspense>
  );
}
