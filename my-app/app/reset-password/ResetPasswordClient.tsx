'use client';

import { useState, useEffect, useRef } from 'react';
import { InvalidResetPassword, SuccessfulResetPassword, ResetPasswordForm } from './ResetPasswordViews';
import { fetchWithCsrf } from '@/lib/csrf';

interface ResetPasswordClientProps {
  token: string | null;
  tokenValid: boolean;
  email: string;
  initialError: string;
}

const validatePassword = (password: string) => {
  const issues: string[] = [];

  if (password.length < 12) {
    issues.push('Password must be at least 12 characters long');
  }
  if (!/[a-z]/.test(password)) {
    issues.push('Password must contain at least one lowercase letter');
  }
  if (!/[A-Z]/.test(password)) {
    issues.push('Password must contain at least one uppercase letter');
  }
  if (!/[0-9]/.test(password)) {
    issues.push('Password must contain at least one number');
  }
  if (!/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)) {
    issues.push('Password must contain at least one special character (!@#$%^&*()_+-=[]{}|;:,.<>?)');
  }

  return {
    isValid: issues.length === 0,
    issues,
  };
};

export default function ResetPasswordClient({ token, tokenValid, email, initialError }: ResetPasswordClientProps) {
  const requestIdRef = useRef(0);
  const [pendingRequestId, setPendingRequestId] = useState<number | null>(null);
  const loading = pendingRequestId !== null;
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(initialError);
  const [issues, setIssues] = useState<string[]>([]);
  const [passwords, setPasswords] = useState({
    newPassword: '',
    confirmPassword: '',
  });
  const [passwordStrength, setPasswordStrength] = useState<{
    isValid: boolean;
    issues: string[];
  }>({ isValid: false, issues: [] });

  useEffect(() => () => { requestIdRef.current += 1; }, []);

  useEffect(() => {
    // Check password strength as user types
    if (passwords.newPassword) {
      const validation = validatePassword(passwords.newPassword);
      setPasswordStrength(validation);
    } else {
      setPasswordStrength({ isValid: false, issues: [] });
    }
  }, [passwords.newPassword]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const requestId = ++requestIdRef.current;
    setPendingRequestId(requestId);
    setError('');
    setIssues([]);

    // Validate passwords match
    if (passwords.newPassword !== passwords.confirmPassword) {
      setError('Passwords do not match');
      setPendingRequestId(null);
      return;
    }

    // Validate password strength
    if (!passwordStrength.isValid) {
      setError('Password does not meet requirements');
      setPendingRequestId(null);
      return;
    }

    try {
      const response = await fetchWithCsrf('/api/auth/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          token,
          newPassword: passwords.newPassword,
        }),
      });

      const data = await response.json();
      if (requestIdRef.current !== requestId) return;

      if (!response.ok) {
        if (data.issues && Array.isArray(data.issues)) {
          setIssues(data.issues);
        }
        throw new Error(data.error || 'Failed to reset password');
      }

      setSuccess(true);
    } catch (err) {
      if (requestIdRef.current === requestId) {
        setError(err instanceof Error ? err.message : 'An error occurred. Please try again.');
      }
    } finally {
      setPendingRequestId((current) => current === requestId ? null : current);
    }
  };

  if (!tokenValid) return <InvalidResetPassword error={error} />;
  if (success) return <SuccessfulResetPassword />;
  return <ResetPasswordForm email={email} error={error} issues={issues} passwords={passwords} setPasswords={setPasswords} passwordStrength={passwordStrength} loading={loading} handleSubmit={handleSubmit} />;
}
