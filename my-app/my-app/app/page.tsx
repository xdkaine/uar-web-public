'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { RequestWorkflow } from '@/components/home/RequestWorkflow';

export default function Home() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  useEffect(() => {
    document.title = 'User Access Request (UAR) Portal - Cal Poly Pomona SOC';
  }, []);

  useEffect(() => {
    fetch('/api/auth/session')
      .then(res => res.json())
      .then(data => {
        setIsAuthenticated(data.isAuthenticated);
      })
      .catch(() => {
        setIsAuthenticated(false);
      });
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-100 text-gray-900">
      <div className="container mx-auto px-4 sm:px-6 md:px-8 py-6 sm:py-10 md:py-16">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="text-center mb-8 sm:mb-12"
        >
          <header>
            <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold text-gray-900 mb-3 sm:mb-4 leading-tight px-2">
              <span className="text-yellow-800">User Access Request Portal</span>
            </h2>
            <p className="text-sm sm:text-base md:text-lg text-gray-700 max-w-3xl mx-auto leading-relaxed px-4">
              Request access for the{' '}
              <a href="https://www.cpp.edu/cba/digital-innovation/index.shtml" className="font-semibold text-blue-600 hover:underline">
                Mitchell C. Hill Student Data Center
              </a>
              {' '}resources which are monitored and managed by the{' '}
              <a href="https://www.calpolysoc.org/team" className="font-semibold text-blue-600 hover:underline">
                Student Directors of the SOC & SDC
              </a>.
            </p>
          </header>
        </motion.div>

        {!isAuthenticated ? (
          <>
            <p className="text-sm sm:text-base md:text-lg text-gray-700 max-w-3xl mx-auto leading-relaxed px-4 mt-4 text-center mb-8">
              Select your student category below to start your access request.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 sm:gap-8 mt-8 sm:mt-12 max-w-5xl mx-auto">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
              >
                <Link href="/request/internal" className="group block h-full">
                  <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8 hover:shadow-xl transition-all duration-300 border-2 border-transparent hover:border-black h-full flex flex-col">
                    <div className="flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 bg-black rounded-full mb-4 sm:mb-6 mx-auto group-hover:scale-110 transition-transform duration-300">
                      <svg className="w-7 h-7 sm:w-8 sm:h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2 sm:mb-3 text-center">
                      Internal Student
                    </h3>
                    <p className="text-sm sm:text-base text-gray-700 text-center mb-4 sm:mb-6">
                      Currently enrolled at Cal Poly Pomona with an <span className="font-bold">@cpp.edu</span> email address
                    </p>
                    <div className="text-center mt-auto">
                      <span className="inline-block px-5 sm:px-6 py-2.5 sm:py-3 bg-black text-white rounded-lg group-hover:bg-gray-800 transition-colors font-semibold text-sm sm:text-base">
                        Request Access →
                      </span>
                    </div>
                  </div>
                </Link>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
              >
                <Link href="/request/external" className="group block h-full">
                  <div className="bg-white rounded-lg shadow-lg p-6 sm:p-8 hover:shadow-xl transition-all duration-300 border-2 border-transparent hover:border-black h-full flex flex-col">
                    <div className="flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 bg-black rounded-full mb-4 sm:mb-6 mx-auto group-hover:scale-110 transition-transform duration-300">
                      <svg className="w-7 h-7 sm:w-8 sm:h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    </div>
                    <h3 className="text-xl sm:text-2xl font-bold text-gray-900 mb-2 sm:mb-3 text-center">
                      External Student
                    </h3>
                    <p className="text-sm sm:text-base text-gray-700 text-center mb-4 sm:mb-6">
                      Non-Cal Poly Pomona Students or external participants requiring temporary access
                    </p>
                    <div className="text-center mt-auto">
                      <span className="inline-block px-5 sm:px-6 py-2.5 sm:py-3 bg-black text-white rounded-lg group-hover:bg-gray-800 transition-colors font-semibold text-sm sm:text-base">
                        Request Access →
                      </span>
                    </div>
                  </div>
                </Link>
              </motion.div>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm sm:text-base md:text-lg text-gray-700 max-w-3xl mx-auto leading-relaxed px-4 mt-4 text-center mb-8">
              Welcome back! Quick access to commonly used features.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 sm:gap-8 mt-8 sm:mt-12 max-w-5xl mx-auto">
              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.1, ease: "easeOut" }}
              >
                <Link href="/instructions" className="group block h-full">
                  <div className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-all duration-300 border-2 border-transparent hover:border-blue-700 h-full flex flex-col">
                    <div className="flex items-center justify-center w-14 h-14 bg-blue-700 rounded-full mb-4 mx-auto group-hover:scale-110 transition-transform duration-300">
                      <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2 text-center">
                      VPN Instructions
                    </h3>
                    <p className="text-sm text-gray-700 text-center mb-4">
                      View your VPN credentials and setup instructions
                    </p>
                    <div className="text-center mt-auto">
                      <span className="inline-block px-5 py-2.5 bg-blue-700 text-white rounded-lg group-hover:bg-blue-800 transition-colors font-semibold text-sm">
                        View Instructions →
                      </span>
                    </div>
                  </div>
                </Link>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.2, ease: "easeOut" }}
              >
                <Link href="/support/tickets" className="group block h-full">
                  <div className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-all duration-300 border-2 border-transparent hover:border-green-700 h-full flex flex-col">
                    <div className="flex items-center justify-center w-14 h-14 bg-green-700 rounded-full mb-4 mx-auto group-hover:scale-110 transition-transform duration-300">
                      <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2 text-center">
                      Support Tickets
                    </h3>
                    <p className="text-sm text-gray-700 text-center mb-4">
                      View and manage your support requests
                    </p>
                    <div className="text-center mt-auto">
                      <span className="inline-block px-5 py-2.5 bg-green-700 text-white rounded-lg group-hover:bg-green-800 transition-colors font-semibold text-sm">
                        My Tickets →
                      </span>
                    </div>
                  </div>
                </Link>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.3, ease: "easeOut" }}
              >
                <Link href="/profile" className="group block h-full">
                  <div className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-all duration-300 border-2 border-transparent hover:border-purple-700 h-full flex flex-col">
                    <div className="flex items-center justify-center w-14 h-14 bg-purple-700 rounded-full mb-4 mx-auto group-hover:scale-110 transition-transform duration-300">
                      <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2 text-center">
                      My Profile
                    </h3>
                    <p className="text-sm text-gray-700 text-center mb-4">
                      Manage your account settings and information
                    </p>
                    <div className="text-center mt-auto">
                      <span className="inline-block px-5 py-2.5 bg-purple-700 text-white rounded-lg group-hover:bg-purple-800 transition-colors font-semibold text-sm">
                        View Profile →
                      </span>
                    </div>
                  </div>
                </Link>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
              >
                <Link href="/forgot-password" className="group block h-full">
                  <div className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-all duration-300 border-2 border-transparent hover:border-orange-700 h-full flex flex-col">
                    <div className="flex items-center justify-center w-14 h-14 bg-orange-700 rounded-full mb-4 mx-auto group-hover:scale-110 transition-transform duration-300">
                      <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2 text-center">
                      Reset Password
                    </h3>
                    <p className="text-sm text-gray-700 text-center mb-4">
                      Change or reset your account password
                    </p>
                    <div className="text-center mt-auto">
                      <span className="inline-block px-5 py-2.5 bg-orange-700 text-white rounded-lg group-hover:bg-orange-800 transition-colors font-semibold text-sm">
                        Reset Password →
                      </span>
                    </div>
                  </div>
                </Link>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 30 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.5, ease: "easeOut" }}
              >
                <Link href="/support/create" className="group block h-full">
                  <div className="bg-white rounded-lg shadow-lg p-6 hover:shadow-xl transition-all duration-300 border-2 border-transparent hover:border-red-700 h-full flex flex-col">
                    <div className="flex items-center justify-center w-14 h-14 bg-red-700 rounded-full mb-4 mx-auto group-hover:scale-110 transition-transform duration-300">
                      <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-2 text-center">
                      Get Help
                    </h3>
                    <p className="text-sm text-gray-700 text-center mb-4">
                      Create a new support ticket for assistance
                    </p>
                    <div className="text-center mt-auto">
                      <span className="inline-block px-5 py-2.5 bg-red-700 text-white rounded-lg group-hover:bg-red-800 transition-colors font-semibold text-sm">
                        Create Ticket →
                      </span>
                    </div>
                  </div>
                </Link>
              </motion.div>

            </div>
          </>
        )}

        <RequestWorkflow />
      </div>
    </div>
  );
}
