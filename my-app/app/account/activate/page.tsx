'use client';

import { useState, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion } from 'framer-motion';
import {
  PASSWORD_ALLOWED_SPECIAL_CHARS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isPasswordCharacterAllowed,
  validatePasswordPolicy,
} from '@/lib/password-policy';

function ActivateAccountForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const token = searchParams.get('token');

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [success, setSuccess] = useState(false);

  const [passwordRequirements, setPasswordRequirements] = useState({
    length: false,
    uppercase: false,
    lowercase: false,
    number: false,
    special: false,
    supportedChars: false,
    noUsername: false,
  });

  useEffect(() => {
    document.title = 'Activate Account | User Access Request (UAR) Portal';
  }, []);

  useEffect(() => {
    if (!token) {
      router.push('/account/activate/expired');
    }
  }, [token, router]);

  useEffect(() => {
    const passwordPolicy = validatePasswordPolicy(password, {
      username: username.trim(),
    });
    const hasIdentityFragment = passwordPolicy.issues.some((issue) =>
      issue.includes('username, email prefix, or name')
    );

    setPasswordRequirements({
      length: password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH,
      uppercase: /[A-Z]/.test(password),
      lowercase: /[a-z]/.test(password),
      number: /[0-9]/.test(password),
      special: [...password].some((char) => PASSWORD_ALLOWED_SPECIAL_CHARS.includes(char)),
      supportedChars: password.length > 0 && [...password].every(isPasswordCharacterAllowed),
      noUsername: password.length > 0 && !hasIdentityFragment,
    });
  }, [password, username]);

  const isPasswordValid = () => {
    return validatePasswordPolicy(password, { username: username.trim() }).isValid;
  };

  const isFormValid = () => {
    return (
      username.trim() !== '' &&
      password === confirmPassword &&
      isPasswordValid()
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIssues([]);

    const passwordValidation = validatePasswordPolicy(password, {
      username: username.trim(),
    });

    if (!isFormValid()) {
      setError('Please ensure all requirements are met');
      setIssues([
        ...passwordValidation.issues,
        ...(password !== confirmPassword ? ['Passwords do not match'] : []),
      ]);
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch('/api/account/activate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          username: username.trim(),
          newPassword: password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        if (response.status === 410) {
          router.push('/account/activate/expired');
          return;
        }
        if (data.issues && Array.isArray(data.issues)) {
          setIssues(data.issues);
        }
        throw new Error(data.error || 'Activation failed');
      }

      setSuccess(true);
      // Set flag for welcome page
      sessionStorage.setItem('account_activated', 'true');
      setTimeout(() => {
        router.push('/account/welcome');
      }, 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-white to-gray-100 py-12 px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="max-w-md w-full"
        >
          <div className="bg-white shadow-xl rounded-lg border-2 border-gray-200 p-8">
            <div className="flex justify-center mb-6">
              <div className="bg-red-600 rounded-full p-3">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </div>
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 text-center mb-4">Invalid Activation Link</h2>
            <p className="text-sm sm:text-base text-gray-700 text-center mb-6">
              The activation link is missing or invalid. Please check your email for the correct link.
            </p>
            <Link
              href="/login"
              className="block w-full text-center bg-black text-white px-4 py-3 rounded hover:bg-gray-800 transition-colors text-sm sm:text-base font-medium"
            >
              Return to Login
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-white to-gray-100 py-12 px-4 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5 }}
          className="max-w-md w-full"
        >
          <div className="bg-white shadow-xl rounded-lg border-2 border-gray-200 p-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
              className="flex justify-center mb-6"
            >
              <div className="bg-green-600 rounded-full p-3">
                <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
            </motion.div>
            <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 text-center mb-4">Account Activated!</h2>
            <p className="text-sm sm:text-base text-gray-700 text-center mb-6">
              Your account has been successfully activated. You will be redirected shortly to see your accessible resources.
            </p>
            <Link
              href="/account/welcome"
              className="block w-full text-center bg-black text-white px-4 py-3 rounded hover:bg-gray-800 transition-colors text-sm sm:text-base font-medium"
            >
              View Accessible Sites
            </Link>
          </div>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-white to-gray-100 py-12 px-4 sm:px-6 lg:px-8">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full"
      >
        <div className="bg-white shadow-xl rounded-lg border-2 border-gray-200 p-8">
          <div className="mb-6">
            <Link
              href="/login"
              className="inline-flex items-center text-sm sm:text-base text-gray-700 hover:text-black hover:underline transition-colors"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Login
            </Link>
          </div>

          <motion.div
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.1, duration: 0.3 }}
            className="flex justify-center mb-6"
          >
            <div className="bg-black rounded-full p-3">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
          </motion.div>

          <h2 className="text-2xl sm:text-3xl font-bold text-gray-900 text-center mb-2">Activate Your Account</h2>
          <p className="text-sm sm:text-base text-gray-600 text-center mb-8">
            Please confirm your username and set your password
          </p>

          {error && (
            <motion.div
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6 text-sm sm:text-base"
            >
              <p className="font-medium">{error}</p>
              {issues.length > 0 && (
                <ul className="list-disc list-inside mt-2 text-sm">
                  {issues.map((issue, index) => (
                    <li key={index}>{issue}</li>
                  ))}
                </ul>
              )}
            </motion.div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
                Active Directory Username
              </label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-4 py-3 border-2 border-gray-200 rounded focus:ring-2 focus:ring-black focus:border-transparent text-sm sm:text-base transition-all"
                placeholder="Enter your AD username"
                required
                disabled={isLoading}
              />
              <p className="mt-2 text-xs sm:text-sm text-gray-500">
                This must match your Active Directory username
              </p>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                New Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded focus:ring-2 focus:ring-black focus:border-transparent text-sm sm:text-base transition-all"
                  placeholder="Enter your new password"
                  required
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                Confirm Password
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  id="confirmPassword"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-4 py-3 border-2 border-gray-200 rounded focus:ring-2 focus:ring-black focus:border-transparent text-sm sm:text-base transition-all"
                  placeholder="Confirm your new password"
                  required
                  disabled={isLoading}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
                >
                  {showConfirmPassword ? (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>
              {confirmPassword && password !== confirmPassword && (
                <p className="mt-2 text-xs sm:text-sm text-red-600">Passwords do not match</p>
              )}
            </div>

            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
              <p className="text-xs sm:text-sm font-medium text-gray-700 mb-3">Password Requirements:</p>
              <ul className="space-y-2 text-xs sm:text-sm">
                <li className={`flex items-center gap-2 ${passwordRequirements.length ? 'text-green-600' : 'text-gray-600'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={passwordRequirements.length ? 'M5 13l4 4L19 7' : 'M6 18L18 6M6 6l12 12'} />
                  </svg>
                  {PASSWORD_MIN_LENGTH}-{PASSWORD_MAX_LENGTH} characters
                </li>
                <li className={`flex items-center gap-2 ${passwordRequirements.uppercase ? 'text-green-600' : 'text-gray-600'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={passwordRequirements.uppercase ? 'M5 13l4 4L19 7' : 'M6 18L18 6M6 6l12 12'} />
                  </svg>
                  At least one uppercase letter
                </li>
                <li className={`flex items-center gap-2 ${passwordRequirements.lowercase ? 'text-green-600' : 'text-gray-600'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={passwordRequirements.lowercase ? 'M5 13l4 4L19 7' : 'M6 18L18 6M6 6l12 12'} />
                  </svg>
                  At least one lowercase letter
                </li>
                <li className={`flex items-center gap-2 ${passwordRequirements.number ? 'text-green-600' : 'text-gray-600'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={passwordRequirements.number ? 'M5 13l4 4L19 7' : 'M6 18L18 6M6 6l12 12'} />
                  </svg>
                  At least one number
                </li>
                <li className={`flex items-center gap-2 ${passwordRequirements.special ? 'text-green-600' : 'text-gray-600'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={passwordRequirements.special ? 'M5 13l4 4L19 7' : 'M6 18L18 6M6 6l12 12'} />
                  </svg>
                  At least one allowed special character ({PASSWORD_ALLOWED_SPECIAL_CHARS})
                </li>
                <li className={`flex items-center gap-2 ${passwordRequirements.supportedChars ? 'text-green-600' : 'text-gray-600'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={passwordRequirements.supportedChars ? 'M5 13l4 4L19 7' : 'M6 18L18 6M6 6l12 12'} />
                  </svg>
                  Only letters, numbers, and allowed special characters
                </li>
                <li className={`flex items-center gap-2 ${passwordRequirements.noUsername ? 'text-green-600' : 'text-gray-600'}`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={passwordRequirements.noUsername ? 'M5 13l4 4L19 7' : 'M6 18L18 6M6 6l12 12'} />
                  </svg>
                  Does not contain your username
                </li>
              </ul>
            </div>

            <button
              type="submit"
              disabled={!isFormValid() || isLoading}
              className="w-full bg-black text-white px-4 py-3 rounded hover:bg-gray-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors text-sm sm:text-base font-medium"
            >
              {isLoading ? 'Activating Account...' : 'Activate Account'}
            </button>
          </form>
        </div>
      </motion.div>
    </div>
  );
}

export default function ActivateAccountPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-white to-gray-100">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-black"></div>
          <p className="mt-4 text-gray-600">Loading...</p>
        </div>
      </div>
    }>
      <ActivateAccountForm />
    </Suspense>
  );
}
