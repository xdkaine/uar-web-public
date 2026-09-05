import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { LazyMotion, domAnimation } from 'framer-motion';
import ForgotPasswordPage from '@/app/forgot-password/page';
import ProfileClient from '@/app/profile/ProfileClient';
import RequestSuccessPage from '@/app/request/success/page';
import AlreadyVerifiedPage from '@/app/verify/already-verified/page';
import VerifyConfirmPage from '@/app/verify/confirm/page';
import VerifyErrorPage from '@/app/verify/error/page';
import VerifySuccessPage from '@/app/verify/success/page';
import { ActivationSuccess } from '@/components/account/ActivationAccountViews';
import '@/app/globals.css';

const profile = {
  username: 'fixture-user',
  displayName: 'Fixture User',
  email: 'fixture-user@cpp.edu',
  groups: [],
  distinguishedName: 'CN=Fixture User,DC=example,DC=test',
};

function ScaleCase({ name, children }: { name: string; children: React.ReactNode }) {
  return <section data-scale-case={name}>{children}</section>;
}

function Fixture() {
  return (
    <main>
      <ScaleCase name="forgot-password"><ForgotPasswordPage /></ScaleCase>
      <ScaleCase name="profile"><ProfileClient profile={profile} recordCheck={null} verification={null} loadError={null} /></ScaleCase>
      <ScaleCase name="request-success"><RequestSuccessPage /></ScaleCase>
      <ScaleCase name="already-verified"><AlreadyVerifiedPage /></ScaleCase>
      <ScaleCase name="verify-confirm"><VerifyConfirmPage /></ScaleCase>
      <ScaleCase name="verify-error"><VerifyErrorPage /></ScaleCase>
      <ScaleCase name="verify-success"><VerifySuccessPage /></ScaleCase>
      <ScaleCase name="activation-success"><ActivationSuccess /></ScaleCase>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><LazyMotion features={domAnimation}><Fixture /></LazyMotion></StrictMode>);
