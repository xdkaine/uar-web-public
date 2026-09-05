import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { NextRequest } from 'next/server';

import { GET as verifyResetToken } from '@/app/api/auth/reset-password/route';
import { LazyMotionBoundary } from '@/components/animations/LazyMotionBoundary';

import ResetPasswordClient from './ResetPasswordClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Reset Password | User Access Request (UAR) Portal',
};

interface ResetPasswordPageProps {
  searchParams: Promise<{ token?: string | string[] }>;
}

export default async function ResetPasswordPage({ searchParams }: ResetPasswordPageProps) {
  const query = await searchParams;
  const token = typeof query.token === 'string' ? query.token : null;
  let tokenValid = false;
  let email = '';
  let initialError = 'No reset token provided';

  if (token) {
    const response = await verifyResetToken(new NextRequest(
      `http://uar.internal/api/auth/reset-password?token=${encodeURIComponent(token)}`,
      { headers: new Headers(await headers()) }
    ));
    const body = await response.json() as { valid?: boolean; email?: string; error?: string };
    tokenValid = response.ok && body.valid === true;
    email = tokenValid ? body.email ?? '' : '';
    initialError = tokenValid ? '' : body.error ?? 'Invalid or expired reset token';
  }

  return (
    <LazyMotionBoundary>
      <ResetPasswordClient
        token={token}
        tokenValid={tokenValid}
        email={email}
        initialError={initialError}
      />
    </LazyMotionBoundary>
  );
}
