'use client';

import type { FormEventHandler } from 'react';
import * as m from 'framer-motion/m';
import type { RecordCheckResult } from './ProfileClient';

export type EmailVerificationPanelProps = {
  recordCheck: RecordCheckResult;
  emailInput: string;
  isCppEmail: boolean;
  submittingEmail: boolean;
  success: string | undefined;
  error: string | undefined;
  onEmailChange: (value: string) => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
};

function getVerificationReason(recordCheck: RecordCheckResult): string {
  if (!recordCheck.hasAccessRequest && !recordCheck.hasVpnAccount)
    return 'We could not find any existing records tied to your Active Directory username in our Access Request or VPN Management systems. To help us maintain accurate records and improve our communication, please verify your email address.';
  if (recordCheck.hasAccessRequest && !recordCheck.hasVpnAccount)
    return `We found an Access Request record for your account, but it ${recordCheck.accessRequestDetails?.isVerified ? 'is missing an email address' : 'needs to be verified'}. Please verify your @cpp.edu email to complete your profile and ensure proper tracking.`;
  if (!recordCheck.hasAccessRequest && recordCheck.hasVpnAccount)
    return 'We found a VPN account for your username, but it is missing an email address. Please verify your @cpp.edu email to complete your profile and link it to your VPN account.';
  return 'We found both Access Request and VPN records for your account, but they are missing email addresses. Please verify your @cpp.edu email to complete your profile.';
}

export default function EmailVerificationPanel({
  recordCheck,
  emailInput,
  isCppEmail,
  submittingEmail,
  success,
  error,
  onEmailChange,
  onSubmit,
}: EmailVerificationPanelProps) {
  return (
    <div className="bg-linear-to-r from-amber-50 to-yellow-50 dark:from-amber-950/40 dark:to-yellow-950/30 border-l-4 border-amber-500 rounded-lg p-6 shadow-md">
      <div className="flex items-start gap-4">
        <div className="shrink-0">
          <div className="w-12 h-12 bg-amber-500 rounded-full flex items-center justify-center">
            <svg
              className="w-6 h-6 text-white"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
              />
            </svg>
          </div>
        </div>
        <div className="flex-1">
          <h3 className="text-xl font-bold text-foreground mb-2">
            Email Verification Required
          </h3>

          <p className="text-foreground/90 mb-3 leading-relaxed">
            {getVerificationReason(recordCheck)}
          </p>

          <div className="bg-card bg-opacity-70 rounded-md p-3 mb-4 border border-amber-200 dark:border-amber-900">
            <p className="text-sm text-foreground/90 leading-relaxed">
              <strong>How it works:</strong> After you submit your @cpp.edu
              email, we&apos;ll send you a verification link. Once verified,
              your email will be synced to your Active Directory account
              {!recordCheck.hasAccessRequest &&
                ' and an access request record will be created for tracking purposes'}
              . This process ensures your account is properly documented in our
              systems.
            </p>
          </div>
        </div>
      </div>

      {success && (
        <m.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 p-4 bg-green-50 dark:bg-green-950/40 border-l-4 border-green-500 rounded-lg shadow-sm"
        >
          <div className="flex items-center gap-3">
            <div className="shrink-0">
              <svg
                className="w-6 h-6 text-green-600 dark:text-green-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <p className="text-green-800 font-medium">{success}</p>
          </div>
        </m.div>
      )}

      {error && (
        <m.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 p-4 bg-red-50 dark:bg-red-950/40 border-l-4 border-red-500 rounded-lg shadow-sm"
        >
          <div className="flex items-center gap-3">
            <div className="shrink-0">
              <svg
                className="w-6 h-6 text-red-600 dark:text-red-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
            <p className="text-red-800 font-medium">{error}</p>
          </div>
        </m.div>
      )}

      <form onSubmit={onSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-semibold text-foreground mb-2"
          >
            Email Address
          </label>
          <input
            type="email"
            id="email"
            value={emailInput}
            onChange={(e) => onEmailChange(e.target.value)}
            placeholder="BroncoName@cpp.edu"
            required
            disabled={submittingEmail}
            pattern="^[^\s@]+@cpp\.edu$"
            title="Email must be a @cpp.edu address"
            className="w-full px-4 py-3 border-2 border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-ring transition-colors disabled:bg-muted disabled:cursor-not-allowed text-foreground"
          />
          <p className="mt-2 text-sm text-muted-foreground">
            Only @cpp.edu email addresses can be verified for this process.
          </p>
          {emailInput.trim() && !isCppEmail && (
            <p className="mt-1 text-sm text-red-600 dark:text-red-400">
              Please enter a valid @cpp.edu email address.
            </p>
          )}
        </div>
        <button
          type="submit"
          disabled={submittingEmail || !isCppEmail}
          className="w-full md:w-auto px-8 py-3 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-[transform,box-shadow,background-color] duration-200 disabled:opacity-50 disabled:cursor-not-allowed font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:transform-none"
        >
          {submittingEmail ? (
            <span className="flex items-center justify-center gap-2">
              <svg
                className="animate-spin h-5 w-5 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              Sending Verification Email...
            </span>
          ) : (
            <span className="flex items-center justify-center gap-2">
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              Send Verification Email
            </span>
          )}
        </button>
      </form>
    </div>
  );
}
