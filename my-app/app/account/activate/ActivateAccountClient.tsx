'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LazyMotionBoundary } from '@/components/animations/LazyMotionBoundary';
import {
  ActivationCredentialsForm,
  ActivationSuccess,
  InvalidActivationLink,
  type PasswordRequirementState,
} from '@/components/account/ActivationAccountViews';
import {
  PASSWORD_ALLOWED_SPECIAL_CHARS,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  isPasswordCharacterAllowed,
  validatePasswordPolicy,
} from '@/lib/password-policy';

function getPasswordRequirements(password: string, username: string): PasswordRequirementState {
  const passwordPolicy = validatePasswordPolicy(password, {
    username: username.trim(),
  });
  const hasIdentityFragment = passwordPolicy.issues.some((issue) =>
    issue.includes('username, email prefix, or name')
  );

  return {
    length: password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH,
    uppercase: /[A-Z]/.test(password),
    lowercase: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: [...password].some((char) => PASSWORD_ALLOWED_SPECIAL_CHARS.includes(char)),
    supportedChars: password.length > 0 && [...password].every(isPasswordCharacterAllowed),
    noUsername: password.length > 0 && !hasIdentityFragment,
  };
}

function ActivateAccountForm({ token }: { token: string }) {
  const router = useRouter();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<string[]>([]);
  const [success, setSuccess] = useState(false);
  const requestIdRef = useRef(0);


  const passwordRequirements = useMemo(
    () => getPasswordRequirements(password, username),
    [password, username]
  );

  const passwordValidation = validatePasswordPolicy(password, {
    username: username.trim(),
  });
  const isFormValid = username.trim() !== '' && password === confirmPassword && passwordValidation.isValid;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const requestId = ++requestIdRef.current;
    setIssues([]);

    if (!isFormValid) {
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
      sessionStorage.setItem('account_activated', 'true');
      setTimeout(() => {
        router.push('/account/welcome');
      }, 3000);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'An error occurred');
    } finally {
      if (requestIdRef.current === requestId) setIsLoading(false);
    }
  };

  if (!token) {
    return <InvalidActivationLink />;
  }

  if (success) {
    return <ActivationSuccess />;
  }

  return (
    <ActivationCredentialsForm
      username={username}
      password={password}
      confirmPassword={confirmPassword}
      visibility={{
        password: showPassword,
        confirmPassword: showConfirmPassword,
      }}
      status={{
        isLoading,
        isValid: isFormValid,
      }}
      error={error}
      issues={issues}
      passwordRequirements={passwordRequirements}
      onUsernameChange={(value) => { setError(''); setUsername(value); }}
      onPasswordChange={(value) => { setError(''); setPassword(value); }}
      onConfirmPasswordChange={(value) => { setError(''); setConfirmPassword(value); }}
      onTogglePassword={() => setShowPassword(!showPassword)}
      onToggleConfirmPassword={() => setShowConfirmPassword(!showConfirmPassword)}
      onSubmit={handleSubmit}
    />
  );
}

export default function ActivateAccountClient({ token }: { token: string }) {
  return (
    <LazyMotionBoundary>
      <ActivateAccountForm token={token} />
    </LazyMotionBoundary>
  );
}
