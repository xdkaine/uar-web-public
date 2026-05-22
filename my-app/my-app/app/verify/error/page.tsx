'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect } from 'react';
import { motion } from 'framer-motion';

function ErrorContent() {
  const searchParams = useSearchParams();
  const reason = searchParams.get('reason');

  useEffect(() => {
    document.title = 'Verification Error | User Access Request (UAR) Portal';
  }, []);

  const errorMessages: Record<string, { title: string; message: string }> = {
    'missing-token': {
      title: 'Missing Verification Token',
      message: 'The verification link is incomplete. Please use the full link from your email.',
    },
    'invalid-token': {
      title: 'Invalid Token',
      message: 'This verification link is not valid. It may have been used already or never existed.',
    },
    'expired': {
      title: 'Link Expired',
      message: 'This verification link has expired. Please submit a new access request.',
    },
    'server-error': {
      title: 'Server Error',
      message: 'An error occurred while processing your request. Please try again later.',
    },
  };

  const error = errorMessages[reason || 'server-error'] || errorMessages['server-error'];

  return (
    <div className="min-h-screen bg-linear-to-b from-white to-gray-100 flex items-center justify-center py-12 px-4">
      <div className="max-w-md w-full">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="bg-white rounded-lg shadow-xl p-8 text-center border-2 border-gray-200"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
            className="flex items-center justify-center w-20 h-20 bg-red-100 rounded-full mb-6 mx-auto"
          >
            <svg className="w-10 h-10 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </motion.div>

          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            {error.title}
          </h1>

          <p className="text-gray-600 mb-6">
            {error.message}
          </p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
            className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-6 text-left"
          >
            <p className="text-sm text-yellow-700 font-medium mb-2">
              What can you do?
            </p>
            <ul className="text-sm text-yellow-600 space-y-2">
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>Check your email for the correct verification link</span>
              </li>
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>Make sure you&apos;re using the complete link</span>
              </li>
              {reason === 'expired' && (
                <li className="flex items-start">
                  <span className="mr-2">•</span>
                  <span>Submit a new access request if the link has expired</span>
                </li>
              )}
              <li className="flex items-start">
                <span className="mr-2">•</span>
                <span>Contact support if you continue to have issues</span>
              </li>
            </ul>
          </motion.div>

          <div className="space-y-3">
            <Link
              href="/"
              className="block w-full py-3 px-6 bg-black hover:bg-gray-800 text-white font-semibold rounded-lg transition-colors duration-300"
            >
              Submit New Request
            </Link>

            <a
              href="mailto:soc@cpp.edu"
              className="block w-full py-3 px-6 border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 hover:bg-gray-50 transition-colors duration-300"
            >
              Contact Support
            </a>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

export default function VerifyErrorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <ErrorContent />
    </Suspense>
  );
}
