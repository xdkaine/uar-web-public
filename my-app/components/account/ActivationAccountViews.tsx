import Link from 'next/link';
import type { FormEventHandler } from 'react';
import * as m from 'framer-motion/m';
import {
  PASSWORD_ALLOWED_SPECIAL_CHARS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
} from '@/lib/password-policy';

export type PasswordRequirementState = {
  length: boolean;
  uppercase: boolean;
  lowercase: boolean;
  number: boolean;
  special: boolean;
  supportedChars: boolean;
  noUsername: boolean;
};

type ActivationCredentialsFormProps = {
  username: string;
  password: string;
  confirmPassword: string;
  visibility: {
    password: boolean;
    confirmPassword: boolean;
  };
  status: {
    isLoading: boolean;
    isValid: boolean;
  };
  error: string;
  issues: string[];
  passwordRequirements: PasswordRequirementState;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onConfirmPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onToggleConfirmPassword: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
};

type PasswordFieldProps = {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  isVisible: boolean;
  isLoading: boolean;
  onChange: (value: string) => void;
  onToggleVisibility: () => void;
};

function PasswordVisibilityIcon({ isVisible }: { isVisible: boolean }) {
  if (isVisible) {
    return (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
      </svg>
    );
  }

  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  );
}

function PasswordField({
  id,
  label,
  placeholder,
  value,
  isVisible,
  isLoading,
  onChange,
  onToggleVisibility,
}: PasswordFieldProps) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground/90 mb-2">
        {label}
      </label>
      <div className="relative">
        <input
          type={isVisible ? 'text' : 'password'}
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full px-4 py-3 border-2 border-border rounded focus:ring-2 focus:ring-ring focus:border-transparent text-sm sm:text-base transition-colors"
          placeholder={placeholder}
          required
          disabled={isLoading}
        />
        <button
          type="button"
          onClick={onToggleVisibility}
          aria-label={`Show ${label.toLowerCase()}`}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground/90"
        >
          <PasswordVisibilityIcon isVisible={isVisible} />
        </button>
      </div>
    </div>
  );
}

function ActivationError({ error, issues }: { error: string; issues: string[] }) {
  if (!error) {
    return null;
  }

  return (
    <m.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-200 px-4 py-3 rounded mb-6 text-sm sm:text-base"
    >
      <p className="font-medium">{error}</p>
      {issues.length > 0 && (
        <ul className="list-disc list-inside mt-2 text-sm">
          {issues.map((issue, index) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </m.div>
  );
}

function RequirementItem({ isMet, children }: { isMet: boolean; children: React.ReactNode }) {
  return (
    <li className={`flex items-center gap-2 ${isMet ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isMet ? 'M5 13l4 4L19 7' : 'M6 18L18 6M6 6l12 12'} />
      </svg>
      {children}
    </li>
  );
}

function PasswordRequirements({ requirements }: { requirements: PasswordRequirementState }) {
  return (
    <div className="bg-muted/50 border border-border rounded-lg p-4">
      <p className="text-xs sm:text-sm font-medium text-foreground/90 mb-3">Password Requirements:</p>
      <ul className="space-y-2 text-xs sm:text-sm">
        <RequirementItem isMet={requirements.length}>
          {PASSWORD_MIN_LENGTH}-{PASSWORD_MAX_LENGTH} characters
        </RequirementItem>
        <RequirementItem isMet={requirements.uppercase}>At least one uppercase letter</RequirementItem>
        <RequirementItem isMet={requirements.lowercase}>At least one lowercase letter</RequirementItem>
        <RequirementItem isMet={requirements.number}>At least one number</RequirementItem>
        <RequirementItem isMet={requirements.special}>
          At least one allowed special character ({PASSWORD_ALLOWED_SPECIAL_CHARS})
        </RequirementItem>
        <RequirementItem isMet={requirements.supportedChars}>
          Only letters, numbers, and allowed special characters
        </RequirementItem>
        <RequirementItem isMet={requirements.noUsername}>Does not contain your username</RequirementItem>
      </ul>
    </div>
  );
}

export function InvalidActivationLink() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <m.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full"
      >
        <div className="bg-card shadow-xl rounded-lg border-2 border-border p-8">
          <div className="flex justify-center mb-6">
            <div className="bg-red-600 rounded-full p-3">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
          </div>
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground text-center mb-4">Invalid Activation Link</h2>
          <p className="text-sm sm:text-base text-foreground/90 text-center mb-6">
            The activation link is missing or invalid. Please check your email for the correct link.
          </p>
          <Link
            href="/login"
            className="block w-full text-center bg-primary text-primary-foreground px-4 py-3 rounded hover:bg-primary/90 transition-colors text-sm sm:text-base font-medium"
          >
            Return to Login
          </Link>
        </div>
      </m.div>
    </div>
  );
}

export function ActivationSuccess() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <m.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full"
      >
        <div className="bg-card shadow-xl rounded-lg border-2 border-border p-8">
          <m.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
            className="flex justify-center mb-6"
          >
            <div className="bg-green-600 rounded-full p-3">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
          </m.div>
          <h2 className="text-2xl sm:text-3xl font-bold text-foreground text-center mb-4">Account Activated!</h2>
          <p className="text-sm sm:text-base text-foreground/90 text-center mb-6">
            Your account has been successfully activated. You will be redirected shortly to see your accessible resources.
          </p>
          <Link
            href="/account/welcome"
            className="block w-full text-center bg-primary text-primary-foreground px-4 py-3 rounded hover:bg-primary/90 transition-colors text-sm sm:text-base font-medium"
          >
            View Accessible Sites
          </Link>
        </div>
      </m.div>
    </div>
  );
}

export function ActivationCredentialsForm({
  username,
  password,
  confirmPassword,
  visibility,
  status,
  error,
  issues,
  passwordRequirements,
  onUsernameChange,
  onPasswordChange,
  onConfirmPasswordChange,
  onTogglePassword,
  onToggleConfirmPassword,
  onSubmit,
}: ActivationCredentialsFormProps) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background py-12 px-4 sm:px-6 lg:px-8">
      <m.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="max-w-md w-full"
      >
        <div className="bg-card shadow-xl rounded-lg border-2 border-border p-8">
          <div className="mb-6">
            <Link href="/login" className="inline-flex items-center text-sm sm:text-base text-foreground/90 hover:text-foreground hover:underline transition-colors">
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back to Login
            </Link>
          </div>

          <m.div initial={{ scale: 0.9 }} animate={{ scale: 1 }} transition={{ delay: 0.1, duration: 0.3 }} className="flex justify-center mb-6">
            <div className="bg-primary rounded-full p-3">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
              </svg>
            </div>
          </m.div>

          <h2 className="text-2xl sm:text-3xl font-bold text-foreground text-center mb-2">Activate Your Account</h2>
          <p className="text-sm sm:text-base text-muted-foreground text-center mb-8">
            Please confirm your username and set your password
          </p>

          <ActivationError error={error} issues={issues} />

          <form onSubmit={onSubmit} className="space-y-6">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-foreground/90 mb-2">
                Active Directory Username
              </label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(event) => onUsernameChange(event.target.value)}
                className="w-full px-4 py-3 border-2 border-border rounded focus:ring-2 focus:ring-ring focus:border-transparent text-sm sm:text-base transition-colors"
                placeholder="Enter your AD username"
                required
                disabled={status.isLoading}
              />
              <p className="mt-2 text-xs sm:text-sm text-muted-foreground">
                This must match your Active Directory username
              </p>
            </div>

            <PasswordField
              id="password"
              label="New Password"
              placeholder="Enter your new password"
              value={password}
              isVisible={visibility.password}
              isLoading={status.isLoading}
              onChange={onPasswordChange}
              onToggleVisibility={onTogglePassword}
            />

            <div>
              <PasswordField
                id="confirmPassword"
                label="Confirm Password"
                placeholder="Confirm your new password"
                value={confirmPassword}
                isVisible={visibility.confirmPassword}
                isLoading={status.isLoading}
                onChange={onConfirmPasswordChange}
                onToggleVisibility={onToggleConfirmPassword}
              />
              {confirmPassword && password !== confirmPassword && (
                <p className="mt-2 text-xs sm:text-sm text-red-600 dark:text-red-400">Passwords do not match</p>
              )}
            </div>

            <PasswordRequirements requirements={passwordRequirements} />

            <button
              type="submit"
              disabled={!status.isValid || status.isLoading}
              className="w-full bg-primary text-primary-foreground px-4 py-3 rounded hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm sm:text-base font-medium"
            >
              {status.isLoading ? 'Activating Account...' : 'Activate Account'}
            </button>
          </form>
        </div>
      </m.div>
    </div>
  );
}
