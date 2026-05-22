'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';

export default function RequestSuccessPage() {
  const router = useRouter();

  useEffect(() => {
    document.title = 'Request Submitted | User Access Request (UAR) Portal';
  }, []);

  return (
    <div className="min-h-screen bg-linear-to-b from-white to-gray-100 flex items-center justify-center py-8 sm:py-12 px-4">
      <div className="max-w-md w-full">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="bg-white rounded-lg shadow-xl p-6 sm:p-8 text-center border-2 border-gray-200"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2, ease: "easeOut" }}
            className="flex items-center justify-center w-16 h-16 sm:w-20 sm:h-20 bg-green-100 rounded-full mb-4 sm:mb-6 mx-auto"
          >
            <svg className="w-8 h-8 sm:w-10 sm:h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 19v-8.93a2 2 0 01.89-1.664l7-4.666a2 2 0 012.22 0l7 4.666A2 2 0 0121 10.07V19M3 19a2 2 0 002 2h14a2 2 0 002-2M3 19l6.75-4.5M21 19l-6.75-4.5M3 10l6.75 4.5M21 10l-6.75 4.5m0 0l-1.14.76a2 2 0 01-2.22 0l-1.14-.76" />
            </svg>
          </motion.div>

          <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 mb-3 sm:mb-4">
            Check Your Email!
          </h1>

          <p className="text-sm sm:text-base text-gray-600 mb-4 sm:mb-6">
            We&apos;ve sent a verification link to your email address. Please click the link to verify your request.
          </p>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4, ease: "easeOut" }}
            className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4 mb-4 sm:mb-6 text-left"
          >
            <p className="text-xs sm:text-sm text-blue-700 font-medium mb-2">
              What happens next?
            </p>
            <ol className="text-xs sm:text-sm text-blue-600 space-y-2">
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
          </motion.div>

          <div className="space-y-2 sm:space-y-3">
            <Link
              href="/"
              className="block w-full py-2.5 sm:py-3 px-4 sm:px-6 bg-black hover:bg-gray-800 text-white font-semibold rounded-lg transition-colors duration-300 text-sm sm:text-base"
            >
              Return to Home
            </Link>

            <button
              onClick={() => router.back()}
              className="block w-full py-2.5 sm:py-3 px-4 sm:px-6 border-2 border-gray-300 text-gray-700 rounded-lg hover:border-gray-400 hover:bg-gray-50 transition-colors duration-300 text-sm sm:text-base"
            >
              Go Back
            </button>
          </div>

          <p className="mt-4 sm:mt-6 text-xs sm:text-sm text-gray-500">
            Didn&apos;t receive the email? Check your spam folder or contact{' '}
            <a href="mailto:soc@cpp.edu" className="text-black hover:underline">
              soc@cpp.edu
            </a>
          </p>
        </motion.div>
      </div>
    </div>
  );
}
