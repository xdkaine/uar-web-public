import Link from 'next/link';
import * as m from 'framer-motion/m';
import type { Dispatch, SetStateAction, FormEvent } from 'react';

export function InvalidResetPassword({ error }: { error: string }) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center py-8 sm:py-12 px-4">
        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-md w-full"
        >
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mb-6 sm:mb-8"
          >
            <Link
              href="/forgot-password"
              className="text-foreground/90 hover:text-foreground hover:underline flex items-center gap-2 justify-center font-medium text-sm sm:text-base"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Request New Link
            </Link>
          </m.div>

          <m.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="bg-card rounded-lg shadow-xl p-6 sm:p-8 border-2 border-border"
          >
            <div className="text-center">
              <m.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.5, delay: 0.5, type: "spring" }}
                className="mx-auto flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-red-100 dark:bg-red-950/60 mb-4"
              >
                <svg className="w-7 h-7 sm:w-8 sm:h-8 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </m.div>
              <m.h1
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
                className="text-2xl sm:text-3xl font-bold text-foreground mb-2"
              >
                Invalid Reset Link
              </m.h1>
              <m.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="text-sm sm:text-base text-muted-foreground mb-6"
              >
                {error || 'This password reset link is invalid or has expired.'}
              </m.p>
              <m.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
              >
                <Link
                  href="/forgot-password"
                  className="inline-flex items-center justify-center gap-2 py-2.5 sm:py-3 px-4 sm:px-6 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg transition-colors text-sm sm:text-base"
                >
                  Request New Link
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
              </m.div>
            </div>
          </m.div>
        </m.div>
      </div>
    );
  }

export function SuccessfulResetPassword() {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center py-8 sm:py-12 px-4">
        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="max-w-md w-full"
        >
          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.2 }}
            className="mb-6 sm:mb-8"
          >
            <Link
              href="/login"
              className="text-foreground/90 hover:text-foreground hover:underline flex items-center gap-2 justify-center font-medium text-sm sm:text-base"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Go to Login
            </Link>
          </m.div>

          <m.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="bg-card rounded-lg shadow-xl p-6 sm:p-8 border-2 border-border"
          >
            <div className="text-center">
              <m.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ scale: 1 }}
                transition={{ duration: 0.5, delay: 0.5, type: "spring" }}
                className="mx-auto flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-green-100 dark:bg-green-950/60 mb-4"
              >
                <svg className="w-7 h-7 sm:w-8 sm:h-8 text-green-600 dark:text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </m.div>
              <m.h1
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
                className="text-2xl sm:text-3xl font-bold text-foreground mb-2"
              >
                Password Reset Successful
              </m.h1>
              <m.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.7 }}
                className="text-sm sm:text-base text-muted-foreground mb-6"
              >
                Your password has been successfully reset. You can now log in with your new password.
              </m.p>
              <m.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
              >
                <Link
                  href="/login"
                  className="inline-flex items-center justify-center gap-2 py-2.5 sm:py-3 px-4 sm:px-6 bg-primary hover:bg-primary/90 text-primary-foreground font-semibold rounded-lg transition-colors text-sm sm:text-base"
                >
                  Go to Login
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </Link>
              </m.div>
            </div>
          </m.div>
        </m.div>
      </div>
    );
  }

function PasswordRequirements({ password }: { password: string }) {
  return (
    <div className="p-3 sm:p-4 bg-muted/50 rounded-lg border border-border">
                <h3 className="text-xs sm:text-sm font-semibold text-foreground mb-3">Password Requirements:</h3>
                <ul className="space-y-2">
                  <li className={`text-xs sm:text-sm flex items-center ${password.length >= 12 ? 'text-green-600 dark:text-green-400 font-medium' : 'text-muted-foreground'}`}>
                    <span className="mr-2 text-base">{password.length >= 12 ? '✓' : '○'}</span>
                    At least 12 characters long
                  </li>
                  <li className={`text-xs sm:text-sm flex items-center ${/[a-z]/.test(password) ? 'text-green-600 dark:text-green-400 font-medium' : 'text-muted-foreground'}`}>
                    <span className="mr-2 text-base">{/[a-z]/.test(password) ? '✓' : '○'}</span>
                    Contains lowercase letter
                  </li>
                  <li className={`text-xs sm:text-sm flex items-center ${/[A-Z]/.test(password) ? 'text-green-600 dark:text-green-400 font-medium' : 'text-muted-foreground'}`}>
                    <span className="mr-2 text-base">{/[A-Z]/.test(password) ? '✓' : '○'}</span>
                    Contains uppercase letter
                  </li>
                  <li className={`text-xs sm:text-sm flex items-center ${/[0-9]/.test(password) ? 'text-green-600 dark:text-green-400 font-medium' : 'text-muted-foreground'}`}>
                    <span className="mr-2 text-base">{/[0-9]/.test(password) ? '✓' : '○'}</span>
                    Contains number
                  </li>
                  <li className={`text-xs sm:text-sm flex items-center ${/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password) ? 'text-green-600 dark:text-green-400 font-medium' : 'text-muted-foreground'}`}>
                    <span className="mr-2 text-base">{/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password) ? '✓' : '○'}</span>
                    Contains special character
                  </li>
                </ul>
              </div>
  );
}

type Passwords = { newPassword: string; confirmPassword: string };
interface ResetPasswordFormProps {
  email: string;
  error: string;
  issues: string[];
  passwords: Passwords;
  setPasswords: Dispatch<SetStateAction<Passwords>>;
  passwordStrength: { isValid: boolean };
  loading: boolean;
  handleSubmit: (event: FormEvent) => void;
}

export function ResetPasswordForm({ email, error, issues, passwords, setPasswords, passwordStrength, loading, handleSubmit }: ResetPasswordFormProps) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center py-8 sm:py-12 px-4">
      <m.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
        className="max-w-md w-full"
      >
        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2 }}
          className="mb-6 sm:mb-8"
        >
          <Link
            href="/login"
            className="text-foreground/90 hover:text-foreground hover:underline flex items-center gap-2 justify-center font-medium text-sm sm:text-base"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Login
          </Link>
        </m.div>

        <m.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="bg-card rounded-lg shadow-xl p-6 sm:p-8 border-2 border-border"
        >
          <div className="text-center mb-6 sm:mb-8">
            <m.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ scale: 1 }}
              transition={{ duration: 0.5, delay: 0.5, type: "spring" }}
              className="flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 bg-primary rounded-full mb-4 mx-auto"
            >
              <svg className="w-7 h-7 sm:w-8 sm:h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </m.div>
            <m.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="text-2xl sm:text-3xl font-bold text-foreground mb-2"
            >
              Set New Password
            </m.h1>
            <m.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
              className="text-sm sm:text-base text-muted-foreground"
            >
              Enter a new password for <strong>{email}</strong>
            </m.p>
          </div>

          {error && (
            <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg">
              <p className="text-xs sm:text-sm text-red-700 dark:text-red-200 font-medium">{error}</p>
              {issues.length > 0 && (
                <ul className="list-disc list-inside mt-2 text-xs sm:text-sm text-red-600 dark:text-red-400">
                  {issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
            <div>
              <label htmlFor="newPassword" className="block text-xs sm:text-sm font-medium text-foreground/90 mb-2">
                New Password
              </label>
              <input
                type="password"
                id="newPassword"
                value={passwords.newPassword}
                onChange={(e) => setPasswords({ ...passwords, newPassword: e.target.value })}
                className="w-full px-3 sm:px-4 py-2.5 sm:py-3 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent bg-card text-foreground text-sm sm:text-base"
                placeholder="••••••••"
                required
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-xs sm:text-sm font-medium text-foreground/90 mb-2">
                Confirm Password
              </label>
              <input
                type="password"
                id="confirmPassword"
                value={passwords.confirmPassword}
                onChange={(e) => setPasswords({ ...passwords, confirmPassword: e.target.value })}
                className="w-full px-3 sm:px-4 py-2.5 sm:py-3 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent bg-card text-foreground text-sm sm:text-base"
                placeholder="••••••••"
                required
              />
            </div>

            {passwords.newPassword && <PasswordRequirements password={passwords.newPassword} />}

            <button
              type="submit"
              disabled={loading || !passwordStrength.isValid || passwords.newPassword !== passwords.confirmPassword}
              className="w-full py-2.5 sm:py-3 px-4 sm:px-6 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-semibold rounded-lg transition-colors duration-200 flex items-center justify-center gap-2 text-sm sm:text-base"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Resetting...
                </>
              ) : (
                <>
                  Reset Password
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </>
              )}
            </button>
          </form>

        </m.div>
      </m.div>
    </div>
  );
}
