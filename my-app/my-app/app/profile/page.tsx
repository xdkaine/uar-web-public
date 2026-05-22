'use client';

import React, { useEffect, useState, Suspense } from 'react';
import { motion } from 'framer-motion';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetchWithCsrf } from '@/lib/csrf';

interface UserProfile {
  username: string;
  displayName: string;
  email: string;
  groups: string[];
  distinguishedName: string;
}

interface RecordCheckResult {
  hasAccessRequest: boolean;
  hasVpnAccount: boolean;
  needsVerification: boolean;
  hasEmail: boolean;
  accessRequestDetails?: {
    id: string;
    email: string;
    status: string;
    isVerified: boolean;
    createdAt: string;
  };
  vpnAccountDetails?: {
    id: string;
    username: string;
    email: string;
    status: string;
    createdAt: string;
  };
}

const CPP_EMAIL_REGEX = /^[^\s@]+@cpp\.edu$/i;

function ProfileContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [recordCheck, setRecordCheck] = useState<RecordCheckResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [checkingRecords, setCheckingRecords] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [emailInput, setEmailInput] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [emailSuccess, setEmailSuccess] = useState<string | null>(null);
  const [submittingEmail, setSubmittingEmail] = useState(false);
  const trimmedEmailInput = emailInput.trim();
  const isCppEmail = CPP_EMAIL_REGEX.test(trimmedEmailInput);

  useEffect(() => {
    document.title = 'My Profile | User Access Request (UAR) Portal';
  }, []);

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const response = await fetch('/api/profile');

        if (response.status === 401) {
          router.push('/login');
          return;
        }

        if (!response.ok) {
          throw new Error('Failed to fetch profile');
        }

        const data = await response.json();
        setProfile(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred');
      } finally {
        setLoading(false);
      }
    };

    const checkExistingRecords = async () => {
      try {
        const response = await fetch('/api/profile/check-records');

        if (response.ok) {
          const data = await response.json();
          setRecordCheck(data);
        }
      } catch (err) {
        console.error('Failed to check existing records:', err);
      } finally {
        setCheckingRecords(false);
      }
    };

    fetchProfile();
    checkExistingRecords();

    // Check for verification status in URL params
    const verification = searchParams.get('verification');
    if (verification === 'success') {
      setEmailSuccess('Your email has been successfully verified and synced to your Active Directory account!');
      // Clear the URL parameter
      window.history.replaceState({}, '', '/profile');
    } else if (verification === 'error') {
      setEmailError('There was an error verifying your email. Please try again or contact support.');
      window.history.replaceState({}, '', '/profile');
    } else if (verification === 'expired') {
      setEmailError('Your verification link has expired. Please request a new one.');
      window.history.replaceState({}, '', '/profile');
    } else if (verification === 'already_verified') {
      setEmailSuccess('Your email has already been verified.');
      window.history.replaceState({}, '', '/profile');
    } else if (verification === 'ad_error') {
      setEmailError('Failed to sync your email to Active Directory. Please contact IT support for assistance.');
      window.history.replaceState({}, '', '/profile');
    } else if (verification === 'unauthorized') {
      setEmailError('You must be signed in with the matching AD account before confirming this email. Please log in and try again.');
      window.history.replaceState({}, '', '/profile');
    }
  }, [router, searchParams]);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailError(null);
    setEmailSuccess(null);
    const normalizedEmail = trimmedEmailInput.toLowerCase();
    if (!trimmedEmailInput) {
      setEmailError('Email address is required');
      return;
    }

    if (!CPP_EMAIL_REGEX.test(trimmedEmailInput)) {
      setEmailError('Only valid @cpp.edu email addresses are supported.');
      return;
    }

    setSubmittingEmail(true);

    try {
      const response = await fetchWithCsrf('/api/profile/verify-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: normalizedEmail }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to send verification email');
      }

      setEmailSuccess(data.message);
      setEmailInput('');
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setSubmittingEmail(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-linear-to-b from-white to-gray-100 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center"
        >
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-black"></div>
          <p className="mt-4 text-gray-600">Loading profile...</p>
        </motion.div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-linear-to-b from-white to-gray-100 flex items-center justify-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white rounded-lg shadow-xl p-8 max-w-md border-2 border-gray-200"
        >
          <div className="text-center">
            <svg
              className="mx-auto h-12 w-12 text-red-500"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <h2 className="mt-4 text-xl font-semibold text-gray-900">Error</h2>
            <p className="mt-2 text-gray-600">{error}</p>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  return (
    <div className="min-h-screen bg-linear-to-b from-white to-gray-100 py-12 px-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
        className="max-w-4xl mx-auto"
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.2 }}
          className="bg-white rounded-lg shadow-xl overflow-hidden border-2 border-gray-200"
        >
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="bg-black px-6 py-8"
          >
            <div className="flex items-center space-x-4">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.5, delay: 0.4, type: "spring" }}
                className="bg-white rounded-full p-4"
              >
                <svg
                  className="w-12 h-12 text-black"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                  />
                </svg>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.6, delay: 0.5 }}
              >
                <p className="text-gray-400 text-sm font-medium">Display Name</p>
                <h1 className="text-3xl font-bold text-white">
                  {profile.displayName || profile.username}
                </h1>
                <p className="text-gray-300 mt-1">User Profile</p>
              </motion.div>
            </div>
          </motion.div>

          <div className="px-6 py-8 space-y-6">
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                <svg
                  className="w-6 h-6 mr-2 text-gray-900"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Basic Information
              </h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-50 rounded-lg p-4">
                  <label className="text-sm font-medium text-gray-500 block mb-1">
                    Username
                  </label>
                  <p className="text-gray-900 font-medium">{profile.username}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4">
                  <label className="text-sm font-medium text-gray-500 block mb-1">
                    Display Name
                  </label>
                  <p className="text-gray-900 font-medium">
                    {profile.displayName || 'N/A'}
                  </p>
                </div>
                <div className="bg-gray-50 rounded-lg p-4 md:col-span-2">
                  <label className="text-sm font-medium text-gray-500 block mb-1">
                    Email Address
                  </label>
                  <p className="text-gray-900 font-medium">{profile.email || 'N/A'}</p>
                </div>
              </div>
            </div>

            {!profile.email && recordCheck && recordCheck.needsVerification && (
              <div className="bg-linear-to-r from-amber-50 to-yellow-50 border-l-4 border-amber-500 rounded-lg p-6 shadow-md">
                <div className="flex items-start gap-4">
                  <div className="shrink-0">
                    <div className="w-12 h-12 bg-amber-500 rounded-full flex items-center justify-center">
                      <svg
                        className="w-6 h-6 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        />
                      </svg>
                    </div>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">
                      Email Verification Required
                    </h3>

                    {!recordCheck.hasAccessRequest && !recordCheck.hasVpnAccount ? (
                      <p className="text-gray-700 mb-3 leading-relaxed">
                        We could not find any existing records tied to your Active Directory username in our
                        Access Request or VPN Management systems. To help us maintain accurate records and
                        improve our communication, please verify your email address.
                      </p>
                    ) : recordCheck.hasAccessRequest && !recordCheck.hasVpnAccount ? (
                      <p className="text-gray-700 mb-3 leading-relaxed">
                        We found an Access Request record for your account, but it {recordCheck.accessRequestDetails?.isVerified ? 'is missing an email address' : 'needs to be verified'}.
                        Please verify your @cpp.edu email to complete your profile and ensure proper tracking.
                      </p>
                    ) : !recordCheck.hasAccessRequest && recordCheck.hasVpnAccount ? (
                      <p className="text-gray-700 mb-3 leading-relaxed">
                        We found a VPN account for your username, but it is missing an email address.
                        Please verify your @cpp.edu email to complete your profile and link it to your VPN account.
                      </p>
                    ) : (
                      <p className="text-gray-700 mb-3 leading-relaxed">
                        We found both Access Request and VPN records for your account, but they are missing email addresses.
                        Please verify your @cpp.edu email to complete your profile.
                      </p>
                    )}

                    <div className="bg-white bg-opacity-70 rounded-md p-3 mb-4 border border-amber-200">
                      <p className="text-sm text-gray-700 leading-relaxed">
                        <strong>How it works:</strong> After you submit your @cpp.edu email, we&apos;ll send you a verification link.
                        Once verified, your email will be synced to your Active Directory account
                        {!recordCheck.hasAccessRequest && ' and an access request record will be created for tracking purposes'}.
                        This process ensures your account is properly documented in our systems.
                      </p>
                    </div>
                  </div>
                </div>

                {emailSuccess && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 p-4 bg-green-50 border-l-4 border-green-500 rounded-lg shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      <div className="shrink-0">
                        <svg
                          className="w-6 h-6 text-green-600"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                      <p className="text-green-800 font-medium">{emailSuccess}</p>
                    </div>
                  </motion.div>
                )}

                {emailError && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mb-4 p-4 bg-red-50 border-l-4 border-red-500 rounded-lg shadow-sm"
                  >
                    <div className="flex items-center gap-3">
                      <div className="shrink-0">
                        <svg
                          className="w-6 h-6 text-red-600"
                          fill="currentColor"
                          viewBox="0 0 20 20"
                        >
                          <path
                            fillRule="evenodd"
                            d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
                            clipRule="evenodd"
                          />
                        </svg>
                      </div>
                      <p className="text-red-800 font-medium">{emailError}</p>
                    </div>
                  </motion.div>
                )}

                <form onSubmit={handleEmailSubmit} className="space-y-4">
                  <div>
                    <label
                      htmlFor="email"
                      className="block text-sm font-semibold text-gray-900 mb-2"
                    >
                      Email Address
                    </label>
                    <input
                      type="email"
                      id="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      placeholder="BroncoName@cpp.edu"
                      required
                      disabled={submittingEmail}
                      pattern="^[^\s@]+@cpp\.edu$"
                      title="Email must be a @cpp.edu address"
                      className="w-full px-4 py-3 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-black transition-all disabled:bg-gray-100 disabled:cursor-not-allowed text-gray-900 placeholder-gray-400"
                    />
                    <p className="mt-2 text-sm text-gray-600">
                      Only @cpp.edu email addresses can be verified for this process.
                    </p>
                    {trimmedEmailInput && !isCppEmail && (
                      <p className="mt-1 text-sm text-red-600">
                        Please enter a valid @cpp.edu email address.
                      </p>
                    )}
                  </div>
                  <button
                    type="submit"
                    disabled={submittingEmail || !isCppEmail}
                    className="w-full md:w-auto px-8 py-3 bg-black text-white rounded-lg hover:bg-gray-800 transition-all duration-200 disabled:bg-gray-400 disabled:cursor-not-allowed font-semibold shadow-lg hover:shadow-xl transform hover:-translate-y-0.5 disabled:transform-none"
                  >
                    {submittingEmail ? (
                      <span className="flex items-center justify-center gap-2">
                        <svg
                          className="animate-spin h-5 w-5 text-white"
                          xmlns="http://www.w3.org/2000/svg"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          ></circle>
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          ></path>
                        </svg>
                        Sending Verification Email...
                      </span>
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <svg
                          className="w-5 h-5"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                          />
                        </svg>
                        Send Verification Email
                      </span>
                    )}
                  </button>
                </form>
              </div>
            )}

            {recordCheck && !recordCheck.needsVerification && (
              <div className="bg-linear-to-r from-green-50 to-emerald-50 border-l-4 border-green-500 rounded-lg p-6 shadow-md">
                <div className="flex items-start gap-4">
                  <div className="shrink-0">
                    <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center">
                      <svg
                        className="w-6 h-6 text-white"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                        />
                      </svg>
                    </div>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">
                      Account Records Found
                    </h3>

                    {recordCheck.hasAccessRequest && recordCheck.hasVpnAccount ? (
                      <p className="text-gray-700 mb-3 leading-relaxed">
                        We found both Access Request and VPN Management records associated with your Active Directory username:
                      </p>
                    ) : recordCheck.hasAccessRequest ? (
                      <p className="text-gray-700 mb-3 leading-relaxed">
                        We found an Access Request record associated with your Active Directory username:
                      </p>
                    ) : (
                      <p className="text-gray-700 mb-3 leading-relaxed">
                        We found a VPN Management record associated with your Active Directory username:
                      </p>
                    )}

                    <div className="space-y-3">
                      {recordCheck.hasAccessRequest && recordCheck.accessRequestDetails && (
                        <div className="bg-white bg-opacity-70 rounded-md p-3 border border-green-200">
                          <p className="text-sm font-semibold text-gray-900 mb-1">Access Request</p>
                          <p className="text-sm text-gray-700">
                            Email: <span className="font-medium">{recordCheck.accessRequestDetails.email || 'Not set'}</span>
                          </p>
                          <p className="text-sm text-gray-700">
                            Status: <span className="font-medium capitalize">{recordCheck.accessRequestDetails.status.replace(/_/g, ' ')}</span>
                          </p>
                          <p className="text-sm text-gray-700">
                            Verified: <span className="font-medium">{recordCheck.accessRequestDetails.isVerified ? '✓ Yes' : '✗ No'}</span>
                          </p>
                          <p className="text-sm text-gray-600 mt-1">
                            Created: {new Date(recordCheck.accessRequestDetails.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      )}
                      {recordCheck.hasVpnAccount && recordCheck.vpnAccountDetails && (
                        <div className="bg-white bg-opacity-70 rounded-md p-3 border border-green-200">
                          <p className="text-sm font-semibold text-gray-900 mb-1">VPN Management</p>
                          <p className="text-sm text-gray-700">
                            Username: <span className="font-medium">{recordCheck.vpnAccountDetails.username}</span>
                          </p>
                          <p className="text-sm text-gray-700">
                            Email: <span className="font-medium">{recordCheck.vpnAccountDetails.email || 'Not set'}</span>
                          </p>
                          <p className="text-sm text-gray-700">
                            Status: <span className="font-medium capitalize">{recordCheck.vpnAccountDetails.status.replace(/_/g, ' ')}</span>
                          </p>
                          <p className="text-sm text-gray-600 mt-1">
                            Created: {new Date(recordCheck.vpnAccountDetails.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      )}
                    </div>

                    {recordCheck.hasEmail ? (
                      <div className="mt-4 p-3 bg-white bg-opacity-70 rounded-md border border-green-200">
                        <p className="text-sm text-gray-700 flex items-center gap-2">
                          <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          <span className="font-medium">Your email is registered in our systems. No further action is required.</span>
                        </p>
                      </div>
                    ) : (
                      <div className="mt-4 p-3 bg-amber-50 rounded-md border border-amber-200">
                        <p className="text-sm text-gray-700 flex items-start gap-2">
                          <svg className="w-5 h-5 text-amber-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                          </svg>
                          <span>
                            Your records exist but are missing email information. While your account is functional,
                            we recommend adding your email by contacting IT support to ensure proper communication.
                          </span>
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}

            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                <svg
                  className="w-6 h-6 mr-2 text-gray-900"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
                Directory Information
              </h2>
              <div className="bg-gray-50 rounded-lg p-4">
                <label className="text-sm font-medium text-gray-500 block mb-1">
                  Distinguished Name
                </label>
                <p className="text-gray-900 font-mono text-sm break-all">
                  {profile.distinguishedName || 'N/A'}
                </p>
              </div>
            </div>

            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-4 flex items-center">
                <svg
                  className="w-6 h-6 mr-2 text-gray-900"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"
                  />
                </svg>
                Group Memberships
              </h2>
              {profile.groups && profile.groups.length > 0 ? (
                <div className="space-y-2 max-h-96 overflow-y-auto">
                  {profile.groups.map((group, index) => (
                    <motion.div
                      key={index}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className="bg-gray-50 rounded-lg p-3 border border-gray-200"
                    >
                      <p className="text-gray-900 text-sm font-mono break-all">
                        {group}
                      </p>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="bg-gray-50 rounded-lg p-4 text-center">
                  <p className="text-gray-500">No group memberships found</p>
                </div>
              )}
            </div>
          </div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5, delay: 0.8 }}
            className="bg-gray-50 px-6 py-4 border-t border-gray-200"
          >
            <p className="text-sm text-gray-500 text-center">
              This information is read-only and retrieved from Active Directory
            </p>
          </motion.div>
        </motion.div>
      </motion.div>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-linear-to-br from-blue-50 to-indigo-50 flex items-center justify-center"><div className="text-gray-600">Loading...</div></div>}>
      <ProfileContent />
    </Suspense>
  );
}
