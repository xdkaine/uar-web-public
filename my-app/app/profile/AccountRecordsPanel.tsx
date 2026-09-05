'use client';

import { useEffect, useState } from 'react';
import type { RecordCheckResult } from './ProfileClient';

function LocalizedDate({ value }: { value: string }) {
  const [formatted, setFormatted] = useState('');
  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      setFormatted(new Date(value).toLocaleDateString()),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [value]);
  return <>{formatted}</>;
}

export default function AccountRecordsPanel({
  recordCheck,
}: {
  recordCheck: RecordCheckResult;
}) {
  return (
    <div className="bg-linear-to-r from-green-50 to-emerald-50 dark:from-green-950/40 dark:to-emerald-950/30 border-l-4 border-green-500 rounded-lg p-6 shadow-md">
      <div className="flex items-start gap-4">
        <div className="shrink-0">
          <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center">
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
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
        </div>
        <div className="flex-1">
          <h3 className="text-xl font-bold text-foreground mb-2">
            Account Records Found
          </h3>

          {recordCheck.hasAccessRequest && recordCheck.hasVpnAccount ? (
            <p className="text-foreground/90 mb-3 leading-relaxed">
              We found both Access Request and VPN Management records associated
              with your Active Directory username:
            </p>
          ) : recordCheck.hasAccessRequest ? (
            <p className="text-foreground/90 mb-3 leading-relaxed">
              We found an Access Request record associated with your Active
              Directory username:
            </p>
          ) : (
            <p className="text-foreground/90 mb-3 leading-relaxed">
              We found a VPN Management record associated with your Active
              Directory username:
            </p>
          )}

          <div className="space-y-3">
            {recordCheck.hasAccessRequest &&
              recordCheck.accessRequestDetails && (
                <div className="bg-card bg-opacity-70 rounded-md p-3 border border-green-200 dark:border-green-900">
                  <p className="text-sm font-semibold text-foreground mb-1">
                    Access Request
                  </p>
                  <p className="text-sm text-foreground/90">
                    Email:{' '}
                    <span className="font-medium">
                      {recordCheck.accessRequestDetails.email || 'Not set'}
                    </span>
                  </p>
                  <p className="text-sm text-foreground/90">
                    Status:{' '}
                    <span className="font-medium capitalize">
                      {recordCheck.accessRequestDetails.status.replace(
                        /_/g,
                        ' ',
                      )}
                    </span>
                  </p>
                  <p className="text-sm text-foreground/90">
                    Verified:{' '}
                    <span className="font-medium">
                      {recordCheck.accessRequestDetails.isVerified
                        ? '✓ Yes'
                        : '✗ No'}
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Created:{' '}
                    <LocalizedDate
                      value={recordCheck.accessRequestDetails.createdAt}
                    />
                  </p>
                </div>
              )}
            {recordCheck.hasVpnAccount && recordCheck.vpnAccountDetails && (
              <div className="bg-card bg-opacity-70 rounded-md p-3 border border-green-200 dark:border-green-900">
                <p className="text-sm font-semibold text-foreground mb-1">
                  VPN Management
                </p>
                <p className="text-sm text-foreground/90">
                  Username:{' '}
                  <span className="font-medium">
                    {recordCheck.vpnAccountDetails.username}
                  </span>
                </p>
                <p className="text-sm text-foreground/90">
                  Email:{' '}
                  <span className="font-medium">
                    {recordCheck.vpnAccountDetails.email || 'Not set'}
                  </span>
                </p>
                <p className="text-sm text-foreground/90">
                  Status:{' '}
                  <span className="font-medium capitalize">
                    {recordCheck.vpnAccountDetails.status.replace(/_/g, ' ')}
                  </span>
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Created:{' '}
                  <LocalizedDate
                    value={recordCheck.vpnAccountDetails.createdAt}
                  />
                </p>
              </div>
            )}
          </div>

          {recordCheck.hasEmail ? (
            <div className="mt-4 p-3 bg-card bg-opacity-70 rounded-md border border-green-200 dark:border-green-900">
              <p className="text-sm text-foreground/90 flex items-center gap-2">
                <svg
                  className="w-5 h-5 text-green-600 dark:text-green-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <span className="font-medium">
                  Your email is registered in our systems. No further action is
                  required.
                </span>
              </p>
            </div>
          ) : (
            <div className="mt-4 p-3 bg-amber-50 dark:bg-amber-950/40 rounded-md border border-amber-200 dark:border-amber-900">
              <p className="text-sm text-foreground/90 flex items-start gap-2">
                <svg
                  className="w-5 h-5 text-amber-600 dark:text-amber-400 mt-0.5"
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
                <span>
                  Your records exist but are missing email information. While
                  your account is functional, we recommend adding your email by
                  contacting IT support to ensure proper communication.
                </span>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
