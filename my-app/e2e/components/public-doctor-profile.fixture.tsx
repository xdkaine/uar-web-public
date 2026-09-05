import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LazyMotion, domAnimation } from 'framer-motion';
import ProfileClient, { type RecordCheckResult, type UserProfile } from '@/app/profile/ProfileClient';
import '@/app/globals.css';

const profile: UserProfile = {
  username: 'fixture-user',
  displayName: 'Fixture User',
  email: '',
  groups: ['CN=fixture-users,OU=Groups,DC=example,DC=test'],
  distinguishedName: 'CN=Fixture User,OU=People,DC=example,DC=test',
  identityProvider: { authProvider: 'ad_manual', idpLinked: false },
};

const recordCheck: RecordCheckResult = {
  hasAccessRequest: true,
  hasVpnAccount: false,
  needsVerification: true,
  hasEmail: false,
  accessRequestDetails: { id: 'fixture-request', email: '', status: 'pending_verification', isVerified: false, createdAt: '2026-09-04T00:00:00.000Z' },
};

function Fixture() {
  const params = new URLSearchParams(location.search);
  const loadError = params.get('mode') === 'loaderror' ? 'Fixture profile failed to load' : null;
  return <LazyMotion features={domAnimation}><ProfileClient profile={profile} recordCheck={recordCheck} verification={params.get('verification')} loadError={loadError} /></LazyMotion>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><Fixture /></StrictMode>);
