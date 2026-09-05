'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import * as m from 'framer-motion/m';
import { LazyMotionBoundary } from '@/components/animations/LazyMotionBoundary';

function VerifySuccessPageContent() {
  useEffect(() => {
    document.title = 'Email Verified | User Access Request (UAR) Portal';
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
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </m.div>

          <h1 className="text-2xl sm:text-3xl font-bold text-foreground mb-3 sm:mb-4">
            Email Verified!
          </h1>

          <p className="text-sm sm:text-base text-muted-foreground mb-4 sm:mb-6">
            Your request has been verified and submitted to our team for review.
          </p>

          <m.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
            className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-lg p-3 sm:p-4 mb-4 sm:mb-6 text-left"
          >
            <p className="text-xs sm:text-sm text-blue-700 dark:text-blue-200 font-medium mb-2">
              What&apos;s next?
            </p>
            <ul className="text-xs sm:text-sm text-blue-600 dark:text-blue-400 space-y-2">
              <li className="flex items-start">
                <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-2 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Our team has been notified of your request</span>
              </li>
              <li className="flex items-start">
                <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-2 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Your request will be reviewed within 1-2 business days</span>
              </li>
              <li className="flex items-start">
                <svg className="w-4 h-4 sm:w-5 sm:h-5 mr-2 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>You&apos;ll receive credentials and instructions via email once approved</span>
              </li>
            </ul>
          </m.div>

          <Link
            href="/"
            className="block w-full py-2.5 sm:py-3 px-4 sm:px-6 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg transition-colors duration-300 text-sm sm:text-base"
          >
            Return to Home
          </Link>

          <p className="mt-4 sm:mt-6 text-xs sm:text-sm text-muted-foreground">
            Questions? Contact{' '}
            <a href="mailto:soc@cpp.edu" className="text-foreground hover:underline">
              soc@cpp.edu
            </a>
          </p>
        </m.div>
      </div>
    </div>
  );
}

export default function VerifySuccessPage() {
  return (
    <LazyMotionBoundary>
      <VerifySuccessPageContent />
    </LazyMotionBoundary>
  );
}
