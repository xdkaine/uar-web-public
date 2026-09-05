import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { GET as getAuthMode } from '@/app/api/auth/mode/route';
import { shouldAutomaticallyStartOidc } from '@/lib/auth/login-selection';
import { getLoginRedirectTarget, getSafeRelativeRedirect } from '@/lib/safe-redirect';
import { getSessionFromCookies } from '@/lib/session';

import LoginClient, { type SignInMethod } from './LoginClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Sign In | User Access Request (UAR) Portal',
};

interface LoginPageProps {
  searchParams: Promise<{ redirect?: string | string[]; error?: string | string[] }>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const query = await searchParams;
  const requestedRedirect = typeof query.redirect === 'string' ? query.redirect : null;
  const redirectTo = getSafeRelativeRedirect(requestedRedirect);
  const queryErrorReason = typeof query.error === 'string' ? query.error : null;
  const session = await getSessionFromCookies();

  if (session) {
    redirect(getLoginRedirectTarget(redirectTo, session.isAdmin));
  }

  const response = await getAuthMode();
  const body = await response.json() as { methods?: SignInMethod[]; error?: string };
  const methods = Array.isArray(body.methods) ? body.methods : [];
  const initialError = methods.length === 0
    ? body.error ?? 'No sign-in method is currently available.'
    : '';

  if (shouldAutomaticallyStartOidc(methods, queryErrorReason ? 'provider error' : '')) {
    const oidcTarget = redirectTo
      ? `/api/auth/oidc/login?redirect=${encodeURIComponent(redirectTo)}`
      : '/api/auth/oidc/login';
    redirect(oidcTarget);
  }

  return (
    <LoginClient
      methods={methods}
      redirectTo={redirectTo}
      queryErrorReason={queryErrorReason}
      initialError={initialError}
    />
  );
}
