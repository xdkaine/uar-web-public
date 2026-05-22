'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { motion } from 'framer-motion';

export default function AlreadyVerifiedPage() {
  useEffect(() => {
    document.title = 'Already Verified | User Access Request (UAR) Portal';
  }, []);

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
            className="flex items-center justify-center w-20 h-20 bg-yellow-100 rounded-full mb-6 mx-auto"
          >
            <svg className="w-10 h-10 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </motion.div>

          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            Already Verified
          </h1>

          <p className="text-gray-600 mb-6">
            This verification link has already been used. Your request has been submitted to our team for review.
          </p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
            className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6 text-left"
          >
            <p className="text-sm text-blue-700 font-medium mb-2">
              What&apos;s happening with your request?
            </p>
            <ul className="text-sm text-blue-600 space-y-2">
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
          </motion.div>

          <div className="space-y-3">
            <Link
              href="/"
              className="block w-full py-3 px-6 bg-black hover:bg-gray-800 text-white font-semibold rounded-lg transition-colors duration-300"
            >
              Return to Home
            </Link>

            <Link
              href="/login"
              className="block w-full py-3 px-6 border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 hover:bg-gray-50 transition-colors duration-300"
            >
              Sign In
            </Link>
          </div>

          <p className="mt-6 text-sm text-gray-500">
            Questions about your request? Contact{' '}
            <a href="mailto:soc@cpp.edu" className="text-black hover:underline">
              soc@cpp.edu
            </a>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
