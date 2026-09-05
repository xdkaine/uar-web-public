import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ForgotPasswordPage from '@/app/forgot-password/page';
import ResetPasswordClient from '@/app/account/reset-password/ResetPasswordClient';
import '@/app/globals.css';

function Fixture() {
  return window.location.pathname.endsWith('/account') ? (
    <ResetPasswordClient username="fixture-user" />
  ) : (
    <ForgotPasswordPage />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
