'use client';

import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useState, useEffect } from 'react';
import * as m from 'framer-motion/m';
import { LazyMotionBoundary } from '@/components/animations/LazyMotionBoundary';
import Link from 'next/link';

function ConfirmContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');
  const [isVerifying, setIsVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = 'Verify Your Email | User Access Request (UAR) Portal';
  }, []);

  const handleVerify = async () => {
    if (!token) {
      setError('Invalid verification link');
      return;
    }

    setIsVerifying(true);
    setError(null);

    try {
      // Note: /api/verify/* is CSRF-exempt (unauthenticated flow)
      // Using regular fetch is safe here, but we could use fetchWithCsrf if needed
      const response = await fetch(`/api/verify/confirm?token=${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();

      if (response.ok) {
        router.push('/verify/success');
      } else {
        setError(data.error || 'Verification failed. Please try again.');
        setIsVerifying(false);
      }
    } catch (err) {
      setError('Network error. Please check your connection and try again.');
      setIsVerifying(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center py-12 px-4">
        <div className="max-w-md w-full">
          <div className="bg-card rounded-lg shadow-xl p-8 text-center border-2 border-red-200 dark:border-red-900">
            <div className="flex items-center justify-center w-20 h-20 bg-red-100 dark:bg-red-950/60 rounded-full mb-6 mx-auto">
              <svg className="w-10 h-10 text-red-600 dark:text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-4">Invalid Link</h1>
            <p className="text-muted-foreground mb-6">
              This verification link is incomplete. Please use the full link from your email.
            </p>
            <Link
              href="/"
              className="inline-block bg-[#1e5631] text-white font-semibold px-6 py-3 rounded-lg hover:bg-[#163f24] transition-colors"
            >
              Return Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full">
        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="bg-card rounded-lg shadow-xl p-8 text-center border-2 border-border"
        >
          <m.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
            className="flex items-center justify-center w-20 h-20 bg-[#1e5631] bg-opacity-10 rounded-full mb-6 mx-auto"
          >
            <svg className="w-10 h-10 text-[#1e5631] dark:text-green-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </m.div>

          <m.h1
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="text-2xl font-bold text-foreground mb-4"
          >
            Verify Your Email
          </m.h1>

          <m.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.5 }}
            className="text-muted-foreground mb-8"
          >
            Click the button below to confirm your email address and complete your access request.
          </m.p>

          {error && (
            <m.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="mb-6 p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg"
            >
              <p className="text-red-800 dark:text-red-200 text-sm">{error}</p>
            </m.div>
          )}

          <m.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.6 }}
            onClick={handleVerify}
            disabled={isVerifying}
            className={`w-full font-semibold px-6 py-3 rounded-lg transition-colors duration-200 ${isVerifying
                ? 'bg-muted-foreground cursor-not-allowed'
                : 'bg-[#1e5631] hover:bg-[#163f24] text-white shadow-lg hover:shadow-xl transform hover:-translate-y-0.5'
              }`}
          >
            {isVerifying ? (
              <span className="flex items-center justify-center">
                <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Verifying...
              </span>
            ) : (
              'Verify Email'
            )}
          </m.button>

          <m.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.7 }}
            className="text-sm text-muted-foreground mt-6"
          >
            This link will expire 24 hours after your request was submitted.
          </m.p>
        </m.div>
      </div>
    </div>
  );
}

export default function VerifyConfirmPage() {
  return (
    <LazyMotionBoundary>
      <Suspense fallback={
        <div className="min-h-screen bg-background flex items-center justify-center">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#1e5631] mx-auto"></div>
            <p className="mt-4 text-muted-foreground">Loading...</p>
          </div>
        </div>
      }>
        <ConfirmContent />
      </Suspense>
    </LazyMotionBoundary>
  );
}
