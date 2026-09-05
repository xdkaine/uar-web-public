'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Turnstile from 'react-turnstile';
import { fetchWithCsrf } from '@/lib/csrf';
import { PublicRequestShell } from '@/components/request/PublicRequestShell';

function InternalRequestPageContent() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const turnstileToken = useRef('');
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
  });

  useEffect(() => {
    document.title = 'Internal Student Access Request | User Access Request (UAR) Portal';
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (!formData.email.endsWith('@cpp.edu')) {
      setError('Please use a valid Cal Poly Pomona email address (@cpp.edu)');
      setLoading(false);
      return;
    }

    try {
      const response = await fetchWithCsrf('/api/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          isInternal: true,
          needsDomainAccount: true, // Always generate domain accounts
          turnstileToken: turnstileToken.current,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit request');
      }

      router.push('/request/success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred. Please try again.');
      setTurnstileKey((prev: number) => prev + 1);
      turnstileToken.current = '';
    } finally {
      setLoading(false);
    }
  };

  return (
    <PublicRequestShell page="requestInternal" kind="internal">
          {error && (
            <div role="alert" className="rounded-md border border-[var(--tone-danger-border)] bg-[var(--tone-danger-bg)] p-3 text-sm text-[var(--tone-danger-fg)]">
              <p className="text-red-700 dark:text-red-200">{error}</p>
            </div>
          )}
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-foreground/90 mb-2">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="name"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-3 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent bg-card text-foreground"
                placeholder="Billy Bronco"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-foreground/90 mb-2">
                Cal Poly Pomona Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                id="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-4 py-3 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent bg-card text-foreground"
                placeholder="billy@cpp.edu"
                pattern=".+@cpp\.edu"
              />
              <p className="mt-1 text-sm text-muted-foreground">
                Must end with @cpp.edu
              </p>
            </div>

            <p className="rounded-md border bg-muted/25 px-3 py-2.5 text-sm text-muted-foreground">We will email a verification link. Review begins after the address is verified.</p>

            <div className="flex justify-center">
              <Turnstile
                key={turnstileKey}
                sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''}
                onVerify={(token) => { turnstileToken.current = token; }}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-6 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-semibold rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Submitting...
                </>
              ) : (
                <>
                  Submit Request
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </>
              )}
            </button>
          </form>
    </PublicRequestShell>
  );
}

export default function InternalRequestPage() {
  return <InternalRequestPageContent />;
}
