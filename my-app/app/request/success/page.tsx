'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as m from 'framer-motion/m';
import { LazyMotionBoundary } from '@/components/animations/LazyMotionBoundary';

function RequestSuccessPageContent() {
  const router = useRouter();

  useEffect(() => {
    document.title = 'Request Submitted | User Access Request (UAR) Portal';
  }, []);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center py-8 sm:py-12 px-4">
      <div className="max-w-md w-full">
        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="bg-card rounded-lg shadow-xl p-6 sm:p-8 text-center border-2 border-border"
        >
          <m.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
            className="flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 bg-green-100 dark:bg-green-950/60 rounded-full mb-4 sm:mb-6 mx-auto"
          >
            <svg className="w-8 h-8 sm:w-10 sm:h-10 text-green-600 dark:text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 19v-8.93a2 2 0 01.89-1.664l7-4.666a2 2 0 012.22 0l7 4.666A2 2 0 0121 10.07V19M3 19a2 2 0 002 2h14a2 2 0 002-2M3 19l6.75-4.5M21 19l-6.75-4.5M3 10l6.75 4.5M21 10l-6.75 4.5m0 0l-1.14.76a2 2 0 01-2.22 0l-1.14-.76" />
            </svg>
          </m.div>

          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3 sm:mb-4">
            Check Your Email!
          </h1>

          <p className="text-sm sm:text-base text-muted-foreground mb-4 sm:mb-6">
            We&apos;ve sent a verification link to your email address. Please click the link to verify your request.
          </p>

          <m.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
            className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-lg p-3 sm:p-4 mb-4 sm:mb-6 text-left"
          >
            <p className="text-xs sm:text-sm text-blue-700 dark:text-blue-200 font-medium mb-2">
              What happens next?
            </p>
            <ol className="text-xs sm:text-sm text-blue-600 dark:text-blue-400 space-y-2">
              <li className="flex items-start">
                <span className="mr-2">1.</span>
                <span>Check your inbox (and spam folder)</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">2.</span>
                <span>Click the verification link in the email</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">3.</span>
                <span>Our team will review your request</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">4.</span>
                <span>You&apos;ll receive account details once approved</span>
              </li>
            </ol>
          </m.div>

          <div className="space-y-2 sm:space-y-3">
            <Link
              href="/"
              className="block w-full py-2.5 sm:py-3 px-4 sm:px-6 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg transition-colors duration-300 text-sm sm:text-base"
            >
              Return to Home
            </Link>

            <button
              onClick={() => router.back()}
              className="block w-full py-2.5 sm:py-3 px-4 sm:px-6 border-2 border-border text-foreground/90 rounded-lg hover:border-ring hover:bg-accent/50 transition-colors duration-300 text-sm sm:text-base"
            >
              Go Back
            </button>
          </div>

          <p className="mt-4 sm:mt-6 text-xs sm:text-sm text-muted-foreground">
            Didn&apos;t receive the email? Check your spam folder or contact{' '}
            <a href="mailto:soc@cpp.edu" className="text-foreground hover:underline">
              soc@cpp.edu
            </a>
          </p>
        </m.div>
      </div>
    </div>
  );
}

export default function RequestSuccessPage() {
  return (
    <LazyMotionBoundary>
      <RequestSuccessPageContent />
    </LazyMotionBoundary>
  );
}
