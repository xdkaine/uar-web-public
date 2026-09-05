'use client';

import React, { useEffect, useState } from 'react';
import * as m from 'framer-motion/m';
import { fetchWithCsrf } from '@/lib/csrf';
import PortalPageHeading from '@/components/appearance/PortalPageHeading';
import EmailVerificationPanel from './EmailVerificationPanel';
import AccountRecordsPanel from './AccountRecordsPanel';
import ProfileMetadataSections from './ProfileMetadataSections';

interface IdentityProviderInfo {
  authProvider: string;
  idpLinked: boolean;
}

export interface UserProfile {
  username: string;
  displayName: string;
  email: string;
  groups: string[];
  distinguishedName: string;
  identityProvider?: IdentityProviderInfo;
}

export interface RecordCheckResult {
  hasAccessRequest: boolean;
  hasVpnAccount: boolean;
  needsVerification: boolean;
  hasEmail: boolean;
  accessRequestDetails?: {
    id: string;
    email: string;
    status: string;
    isVerified: boolean;
    createdAt: string;
  };
  vpnAccountDetails?: {
    id: string;
    username: string;
    email: string;
    status: string;
    createdAt: string;
  };
}

const CPP_EMAIL_REGEX = /^[^\s@]+@cpp\.edu$/i;
const VERIFICATION_NOTICES: Record<
  string,
  { error?: string; success?: string }
> = {
  success: {
    success:
      'Your email has been successfully verified and synced to your Active Directory account!',
  },
  error: {
    error:
      'There was an error verifying your email. Please try again or contact support.',
  },
  expired: {
    error: 'Your verification link has expired. Please request a new one.',
  },
  already_verified: { success: 'Your email has already been verified.' },
  ad_error: {
    error:
      'Failed to sync your email to Active Directory. Please contact IT support for assistance.',
  },
  unauthorized: {
    error:
      'You must be signed in with the matching AD account before confirming this email. Please log in and try again.',
  },
  conflict: {
    error:
      'Active Directory already contains a different email address. Nothing was overwritten; contact support to reconcile the records.',
  },
  reconciliation_required: {
    error:
      'The directory update succeeded, but the portal could not finish recording it. Support can safely reconcile this without clearing your directory email.',
  },
  in_progress: {
    error:
      'This verification link is already being processed. Wait a moment, then open it again.',
  },
};

interface ProfileClientProps {
  profile: UserProfile | null;
  recordCheck: RecordCheckResult | null;
  verification: string | null;
  loadError: string | null;
}

export default function ProfileClient({
  profile,
  recordCheck,
  verification,
  loadError,
}: ProfileClientProps) {
  const error = loadError;
  const [emailInput, setEmailInput] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);
  const [submittingEmail, setSubmittingEmail] = useState(false);
  const [dismissedVerification, setDismissedVerification] = useState<string | null>(null);
  const trimmedEmailInput = emailInput.trim();
  const isCppEmail = CPP_EMAIL_REGEX.test(trimmedEmailInput);
  const verificationNotice = verification && dismissedVerification !== verification
    ? VERIFICATION_NOTICES[verification]
    : undefined;
  const displayedEmailSuccess = emailSuccess ?? verificationNotice?.success;
  const displayedEmailError = emailError ?? verificationNotice?.error;

  useEffect(() => {
    if (verification) {
      window.history.replaceState({}, '', '/profile');
    }
  }, [verification]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);
    setEmailSuccess(null);
    const normalizedEmail = trimmedEmailInput.toLowerCase();
    if (!trimmedEmailInput) {
      setEmailError('Email address is required');
      return;
    }

    if (!CPP_EMAIL_REGEX.test(trimmedEmailInput)) {
      setEmailError('Only valid @cpp.edu email addresses are supported.');
      return;
    }

    setDismissedVerification(verification);
    setSubmittingEmail(true);

    try {
      const response = await fetchWithCsrf('/api/profile/verify-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: normalizedEmail }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send verification email');
      }

      setEmailSuccess(data.message);
      setEmailInput('');
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSubmittingEmail(false);
    }
  };

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-card rounded-lg shadow-xl p-8 max-w-md border-2 border-border"
        >
          <div className="text-center">
            <svg
              className="mx-auto h-12 w-12 text-red-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h2 className="mt-4 text-xl font-semibold text-foreground">
              Error
            </h2>
            <p className="mt-2 text-muted-foreground">{error}</p>
          </div>
        </m.div>
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <m.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className="max-w-4xl mx-auto"
      >
        <PortalPageHeading page="profile" className="mb-6" />
        <m.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="bg-card rounded-lg shadow-xl overflow-hidden border-2 border-border"
        >
          <m.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="bg-primary px-6 py-8"
          >
            <div className="flex items-center space-x-4">
              <m.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.5, delay: 0.4, type: 'spring' }}
                className="bg-card rounded-full p-4"
              >
                <svg
                  className="w-12 h-12 text-foreground"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
              </m.div>
              <m.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.5 }}
              >
                <p className="text-primary-foreground/80 text-sm font-medium">
                  Display Name
                </p>
                <h1 className="text-3xl font-bold text-primary-foreground">
                  {profile.displayName || profile.username}
                </h1>
                <p className="text-muted-foreground mt-1">User Profile</p>
              </m.div>
            </div>
          </m.div>

          <div className="px-6 py-8 space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-foreground mb-4 flex items-center">
                <svg
                  className="w-6 h-6 mr-2 text-foreground"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Basic Information
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-muted/50 rounded-lg p-4">
                  <p className="text-sm font-medium text-muted-foreground block mb-1">
                    Username
                  </p>
                  <p className="text-foreground font-medium">
                    {profile.username}
                  </p>
                </div>
                <div className="bg-muted/50 rounded-lg p-4">
                  <p className="text-sm font-medium text-muted-foreground block mb-1">
                    Display Name
                  </p>
                  <p className="text-foreground font-medium">
                    {profile.displayName || 'N/A'}
                  </p>
                </div>
                <div className="bg-muted/50 rounded-lg p-4 md:col-span-2">
                  <p className="text-sm font-medium text-muted-foreground block mb-1">
                    Email Address
                  </p>
                  <p className="text-foreground font-medium">
                    {profile.email || 'N/A'}
                  </p>
                </div>
              </div>
            </div>

            {!profile.email && recordCheck && recordCheck.needsVerification && (
              <EmailVerificationPanel
                recordCheck={recordCheck}
                emailInput={emailInput}
                isCppEmail={isCppEmail}
                submittingEmail={submittingEmail}
                success={displayedEmailSuccess}
                error={displayedEmailError}
                onEmailChange={setEmailInput}
                onSubmit={handleEmailSubmit}
              />
            )}

            {recordCheck && !recordCheck.needsVerification && (
              <AccountRecordsPanel recordCheck={recordCheck} />
            )}

            <ProfileMetadataSections profile={profile} />
          </div>
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.8 }}
            className="bg-muted/50 px-6 py-4 border-t border-border"
          >
            <p className="text-sm text-muted-foreground text-center">
              This information is read-only: attributes come from Active
              Directory, sign-in details from the UAR identity provider.
            </p>
          </m.div>
        </m.div>
      </m.div>
    </div>
  );
}
