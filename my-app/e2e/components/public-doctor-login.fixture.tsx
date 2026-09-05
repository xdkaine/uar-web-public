import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LazyMotion, domAnimation } from 'framer-motion';
import LoginClient, { type SignInMethod } from '@/app/login/LoginClient';
import '@/app/globals.css';

const directMethods: SignInMethod[] = [
  {
    id: 'oidc',
    displayName: 'Company sign-in',
    description: 'Use the configured identity provider.',
  },
  {
    id: 'native_ad',
    displayName: 'Active Directory',
    description: 'Use a directory account directly.',
  },
  {
    id: 'local_break_glass',
    displayName: 'Emergency local account',
    description: 'Use only approved emergency access.',
  },
];

function Fixture() {
  const [mounted, setMounted] = useState(true);
  const params = new URLSearchParams(location.search);
  const oidcOnly = params.get('mode') === 'oidc-retry';
  const methods = oidcOnly ? [directMethods[0]] : directMethods;

  return (
    <>
      <button type="button" onClick={() => setMounted(false)}>Unmount fixture</button>
      {mounted && (
        <LazyMotion features={domAnimation}>
          <LoginClient
            methods={methods}
            redirectTo="/admin"
            queryErrorReason={oidcOnly ? 'oidc_failed' : null}
            initialError=""
          />
        </LazyMotion>
      )}
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
