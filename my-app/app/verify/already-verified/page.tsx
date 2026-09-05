'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import * as m from 'framer-motion/m';
import { LazyMotionBoundary } from '@/components/animations/LazyMotionBoundary';

function AlreadyVerifiedPageContent() {
  useEffect(() => {
    document.title = 'Already Verified | User Access Request (UAR) Portal';
  }, []);

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
            className="flex items-center justify-center w-20 h-20 bg-yellow-100 dark:bg-yellow-950/60 rounded-full mb-6 mx-auto"
          >
            <svg className="w-10 h-10 text-yellow-600 dark:text-yellow-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </m.div>

          <h1 className="text-3xl font-bold text-foreground mb-4">
            Already Verified
          </h1>

          <p className="text-muted-foreground mb-6">
            This verification link has already been used. Your request has been submitted to our team for review.
          </p>

          <m.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
            className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-lg p-4 mb-6 text-left"
          >
            <p className="text-sm text-blue-700 dark:text-blue-200 font-medium mb-2">
              What&apos;s happening with your request?
            </p>
            <ul className="text-sm text-blue-600 dark:text-blue-400 space-y-2">
              <li className="flex items-start">
                <svg className="w-5 h-5 mr-2 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Your email has been verified</span>
              </li>
              <li className="flex items-start">
                <svg className="w-5 h-5 mr-2 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>Our team is reviewing your request</span>
              </li>
              <li className="flex items-start">
                <svg className="w-5 h-5 mr-2 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <span>You&apos;ll receive an email once approved</span>
              </li>
            </ul>
          </m.div>

          <div className="space-y-3">
            <Link
              href="/"
              className="block w-full py-3 px-6 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg transition-colors duration-300"
            >
              Return to Home
            </Link>

            <Link
              href="/login"
              className="block w-full py-3 px-6 border-2 border-border text-foreground/90 rounded-lg hover:border-ring hover:bg-accent/50 transition-colors duration-300"
            >
              Sign In
            </Link>
          </div>

          <p className="mt-6 text-sm text-muted-foreground">
            Questions about your request? Contact{' '}
            <a href="mailto:soc@cpp.edu" className="text-foreground hover:underline">
              soc@cpp.edu
            </a>
          </p>
        </m.div>
      </div>
    </div>
  );
}

export default function AlreadyVerifiedPage() {
  return (
    <LazyMotionBoundary>
      <AlreadyVerifiedPageContent />
    </LazyMotionBoundary>
  );
}
