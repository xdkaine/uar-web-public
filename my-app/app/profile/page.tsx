import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { GET as getProfile } from '@/app/api/profile/route';
import { GET as checkProfileRecords } from '@/app/api/profile/check-records/route';
import { LazyMotionBoundary } from '@/components/animations/LazyMotionBoundary';

import ProfileClient, { type RecordCheckResult, type UserProfile } from './ProfileClient';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'My Profile | User Access Request (UAR) Portal',
};

interface ProfilePageProps {
  searchParams: Promise<{ verification?: string | string[] }>;
}

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const [profileResponse, recordsResponse, query] = await Promise.all([
    getProfile(),
    checkProfileRecords(),
    searchParams,
  ]);

  if (profileResponse.status === 401) {
    redirect('/login');
  }

  const profileBody = await profileResponse.json() as UserProfile & { error?: string };
  const recordsBody = recordsResponse.ok
    ? await recordsResponse.json() as RecordCheckResult
    : null;
  const verification = typeof query.verification === 'string' ? query.verification : null;

  return (
    <LazyMotionBoundary>
      <ProfileClient
        profile={profileResponse.ok ? profileBody : null}
        recordCheck={recordsBody}
        verification={verification}
        loadError={profileResponse.ok ? null : profileBody.error ?? 'An error occurred'}
      />
    </LazyMotionBoundary>
  );
}
