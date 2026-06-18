'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { validatePasswordPolicy } from '@/lib/password-policy';

function ConfirmContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');
  const [passwordStepStarted, setPasswordStepStarted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<string[]>([]);
  const [passwords, setPasswords] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const passwordValidation = validatePasswordPolicy(passwords.newPassword);
  const passwordsMatch = passwords.newPassword === passwords.confirmPassword;
  const visibleIssues = issues.length > 0
    ? issues
    : passwords.newPassword
      ? passwordValidation.issues
      : [];

  const handleConfirm = async () => {
    if (!token) {
      setError('This confirmation link is missing its token.');
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setIssues([]);

    try {
      const response = await fetch(`/api/offboard/verify/confirm?token=${encodeURIComponent(token)}`);
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Confirmation link could not be validated');
      }

      if (data.alreadyVerified) {
        router.push('/offboard/verify/success');
        return;
      }

      setPasswordStepStarted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirmation link could not be validated');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePasswordSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!token) {
      setError('This confirmation link is missing its token.');
      return;
    }

    if (!passwords.currentPassword || !passwords.newPassword || !passwords.confirmPassword) {
      setError('All password fields are required.');
      return;
    }

    if (!passwordsMatch) {
      setError('New passwords do not match.');
      return;
    }

    if (!passwordValidation.isValid) {
      setError('New password does not meet requirements.');
      setIssues(passwordValidation.issues);
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setIssues([]);

    try {
      const response = await fetch(`/api/offboard/verify/confirm?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwords.currentPassword,
          newPassword: passwords.newPassword,
        }),
      });
      const data = await response.json();

      if (!response.ok) {
        if (data.issues && Array.isArray(data.issues)) {
          setIssues(data.issues);
        }
        throw new Error(data.error || 'Confirmation failed');
      }

      router.push('/offboard/verify/success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Confirmation failed');
      setIsSubmitting(false);
    }
  };

  if (!token) {
    return (
      <div className="mx-auto max-w-md rounded-lg border bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">Invalid Link</h1>
        <p className="mt-3 text-sm text-gray-600">Use the full confirmation link from your email.</p>
        <Link href="/" className="mt-6 inline-flex h-10 items-center rounded-md bg-[#1e5631] px-4 text-sm font-medium text-white">
          Return Home
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md rounded-lg border bg-white p-8 text-center shadow-sm">
      <h1 className="text-2xl font-semibold text-gray-900">Confirm Continued Access</h1>
      <p className="mt-3 text-sm leading-6 text-gray-600">
        Confirm that you still need your Student SOC account access. After this check, you will update your AD password before the confirmation is recorded.
      </p>

      {error && (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {visibleIssues.length > 0 && (
        <div className="mt-4 rounded-md border border-yellow-200 bg-yellow-50 p-3 text-left text-xs text-yellow-900">
          <p className="font-semibold">New password requirements</p>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {visibleIssues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      )}

      {!passwordStepStarted ? (
        <button
          type="button"
          onClick={handleConfirm}
          disabled={isSubmitting}
          className="mt-6 inline-flex h-11 w-full items-center justify-center rounded-md bg-[#1e5631] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#163f24] disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {isSubmitting ? 'Checking Link...' : 'Confirm Continued Access'}
        </button>
      ) : (
        <form onSubmit={handlePasswordSubmit} className="mt-6 space-y-4 text-left">
          <div>
            <label htmlFor="currentPassword" className="block text-sm font-medium text-gray-700">
              Current AD password
            </label>
            <input
              id="currentPassword"
              type="password"
              autoComplete="current-password"
              value={passwords.currentPassword}
              onChange={(event) => setPasswords({ ...passwords, currentPassword: event.target.value })}
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-[#1e5631] focus:outline-none focus:ring-2 focus:ring-[#1e5631]/20"
              required
            />
          </div>
          <div>
            <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700">
              New AD password
            </label>
            <input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              value={passwords.newPassword}
              onChange={(event) => {
                setIssues([]);
                setPasswords({ ...passwords, newPassword: event.target.value });
              }}
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-[#1e5631] focus:outline-none focus:ring-2 focus:ring-[#1e5631]/20"
              required
            />
          </div>
          <div>
            <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700">
              Confirm new AD password
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={passwords.confirmPassword}
              onChange={(event) => setPasswords({ ...passwords, confirmPassword: event.target.value })}
              className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-[#1e5631] focus:outline-none focus:ring-2 focus:ring-[#1e5631]/20"
              required
            />
            {passwords.confirmPassword && !passwordsMatch && (
              <p className="mt-2 text-xs font-medium text-red-700">New passwords do not match.</p>
            )}
          </div>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex h-11 w-full items-center justify-center rounded-md bg-[#1e5631] px-4 text-sm font-semibold text-white transition-colors hover:bg-[#163f24] disabled:cursor-not-allowed disabled:bg-gray-400"
          >
            {isSubmitting ? 'Updating Password...' : 'Update Password and Confirm'}
          </button>
        </form>
      )}
    </div>
  );
}

export default function OffboardVerifyConfirmPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <Suspense fallback={<div className="text-sm text-gray-600">Loading...</div>}>
        <ConfirmContent />
      </Suspense>
    </main>
  );
}
