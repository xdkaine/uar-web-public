'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import Turnstile from 'react-turnstile';
import { fetchWithCsrf } from '@/lib/csrf';

export default function InternalRequestPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
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
          turnstileToken,
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
      setTurnstileToken('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-b from-white to-gray-100 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <button
            onClick={() => router.push('/')}
            className="text-gray-700 hover:text-black hover:underline flex items-center gap-2 font-medium"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Home
          </button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="bg-white rounded-lg shadow-xl p-8 border-2 border-gray-200"
        >
          <div className="mb-8">
            <div className="flex items-center justify-center w-16 h-16 bg-black rounded-full mb-4 mx-auto">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 text-center mb-2">
              Internal Student Access Request
            </h1>
            <p className="text-gray-600 text-center">
              Request an account to be created for Kamino/Proxmox/SDC Domains
            </p>
            {<div className="bg-red-50 border border-blue-200 rounded-lg p-4 mt-4">
              <p className="text-red-700 text-sm">
                If you are a Cal Poly Pomona Student, you must submit two requests, <a href="https://cpp.service-now.com/ehelp?id=sc_cat_item&sys_id=17e10ab82b11e2505379f85ab891bf71&sysparm_category=d2f7cae4c611227a018ddc481b34e099" className="underline hover:text-blue-800">CPP: ServiceNow</a>.
                To ensure your access requests are received, ensure that you have submitted one request via this portal and the other portal linked before.
              </p>
            </div>}
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700">{error}</p>
            </div>
          )}

          <div className="mb-4 text-sm text-gray-600">
            <p>Fields marked with an asterisk (<span className="text-red-500">*</span>) are required.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
                Full Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="name"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent bg-white text-gray-900"
                placeholder="Billy Bronco"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Cal Poly Pomona Email <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                id="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent bg-white text-gray-900"
                placeholder="billy@cpp.edu"
                pattern=".+@cpp\.edu"
              />
              <p className="mt-1 text-sm text-gray-500">
                Must end with @cpp.edu
              </p>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-yellow-600 mt-0.5 mr-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <div className="text-sm text-yellow-700">
                  <p className="font-medium mb-1">Next Steps:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>You&apos;ll receive a verification email sent to the email address above</li>
                    <li>You must verify your request by clicking the link in the email</li>
                    <li>Your request will enter a queue and will take 1-48 hours to process</li>
                    <li>You&apos;ll receive an update at the same address with the status of your request</li>
                    <li>If approved, your status update will include your new credentials and access instructions</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex justify-center">
              <Turnstile
                key={turnstileKey}
                sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''}
                onVerify={(token) => setTurnstileToken(token)}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-6 bg-black hover:bg-gray-800 disabled:bg-gray-400 text-white font-semibold rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
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
        </motion.div>

        <div className="mt-6 text-center text-sm text-gray-600">
          <p>
            Need help? Contact IT Support at{' '}
            <a href="mailto:soc@cpp.edu" className="text-black hover:underline">
              soc@cpp.edu
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
