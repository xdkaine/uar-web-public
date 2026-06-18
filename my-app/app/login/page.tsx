'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Turnstile from 'react-turnstile';
import { fetchWithCsrf, refreshCsrfToken } from '@/lib/csrf';
import { validatePasswordPolicy } from '@/lib/password-policy';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, ArrowRight, Lock, User, AlertCircle, ChevronLeft } from "lucide-react";

type LoginResponse = {
  action?: string;
  reason?: string;
  message?: string;
  error?: string;
  issues?: string[];
  isAdmin?: boolean;
  requiresLogin?: boolean;
};

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [credentials, setCredentials] = useState({
    username: '',
    password: '',
  });
  const [passwordChangeRequired, setPasswordChangeRequired] = useState(false);
  const [passwordChangeIssues, setPasswordChangeIssues] = useState<string[]>([]);
  const [passwordChange, setPasswordChange] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [turnstileKey, setTurnstileKey] = useState(0);

  // Get the redirect parameter from the URL
  const redirectTo = searchParams.get('redirect');
  const passwordValidation = validatePasswordPolicy(passwordChange.newPassword, {
    username: credentials.username.trim(),
  });
  const passwordChangeVisibleIssues = passwordChangeIssues.length > 0
    ? passwordChangeIssues
    : passwordChange.newPassword
      ? passwordValidation.issues
      : [];
  const passwordChangePasswordsMatch = passwordChange.newPassword === passwordChange.confirmPassword;

  useEffect(() => {
    document.title = 'Sign In | User Access Request (UAR) Portal';
  }, []);

  // Check if user is already authenticated on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth/session');
        const data = await response.json();

        if (data.isAuthenticated) {
          // User is already logged in, redirect them
          if (redirectTo) {
            if (redirectTo.startsWith('/admin')) {
              if (data.isAdmin) {
                router.push(redirectTo);
              } else {
                router.push('/instructions');
              }
            } else {
              router.push(redirectTo);
            }
          } else if (data.isAdmin) {
            router.push('/admin');
          } else {
            router.push('/instructions');
          }
        }
      } catch (error) {
        // If check fails, stay on login page
        console.error('Auth check failed:', error);
      }
    };

    checkAuth();
  }, [redirectTo, router]);

  const completeLoginRedirect = async (data: LoginResponse) => {
    await new Promise(resolve => setTimeout(resolve, 100));
    await refreshCsrfToken(true);
    window.dispatchEvent(new Event('authStateChanged'));
    await new Promise(resolve => setTimeout(resolve, 200));

    if (redirectTo) {
      if (redirectTo.startsWith('/admin')) {
        if (data.isAdmin) {
          router.push(redirectTo);
        } else {
          router.push('/instructions');
        }
      } else {
        router.push(redirectTo);
      }
    } else if (data.isAdmin) {
      router.push('/admin');
    } else {
      router.push('/instructions');
    }
  };

  const resetTurnstile = () => {
    setTurnstileKey((prev: number) => prev + 1);
    setTurnstileToken('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setPasswordChangeIssues([]);

    try {
      const response = await fetchWithCsrf('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ...credentials, turnstileToken }),
      });

      const data: LoginResponse = await response.json();

      if (!response.ok) {
        if (response.status === 409 && data.action === 'PASSWORD_CHANGE_REQUIRED') {
          setPasswordChangeRequired(true);
          setPasswordChange({ currentPassword: '', newPassword: '', confirmPassword: '' });
          setCredentials({ ...credentials, password: '' });
          resetTurnstile();
          setError(data.message || 'Your account requires a new password before sign in can continue.');
          return;
        }

        throw new Error(data.error || 'Authentication failed');
      }

      await completeLoginRedirect(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred. Please try again.');
      resetTurnstile();
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordChangeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setPasswordChangeIssues([]);

    if (!passwordChange.currentPassword || !passwordChange.newPassword || !passwordChange.confirmPassword) {
      setError('All password fields are required.');
      return;
    }

    if (!passwordChangePasswordsMatch) {
      setError('New passwords do not match.');
      return;
    }

    if (!passwordValidation.isValid) {
      setError('New password does not meet requirements.');
      setPasswordChangeIssues(passwordValidation.issues);
      return;
    }

    setLoading(true);

    try {
      const response = await fetchWithCsrf('/api/auth/complete-required-password-change', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          currentPassword: passwordChange.currentPassword,
          newPassword: passwordChange.newPassword,
        }),
      });

      const data: LoginResponse = await response.json();

      if (!response.ok) {
        if (data.issues && Array.isArray(data.issues)) {
          setPasswordChangeIssues(data.issues);
        }
        throw new Error(data.error || 'Failed to update password');
      }

      if (data.requiresLogin) {
        setPasswordChangeRequired(false);
        setPasswordChange({ currentPassword: '', newPassword: '', confirmPassword: '' });
        setCredentials({ ...credentials, password: '' });
        resetTurnstile();
        setError(data.message || 'Password updated. Please sign in with your new password.');
        return;
      }

      await completeLoginRedirect(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const cancelPasswordChange = () => {
    setPasswordChangeRequired(false);
    setPasswordChange({ currentPassword: '', newPassword: '', confirmPassword: '' });
    setPasswordChangeIssues([]);
    setError('');
    resetTurnstile();
  };

  return (
    <div className="min-h-screen bg-linear-to-b from-white to-gray-100 flex items-center justify-center py-8 sm:py-12 px-4">
      <div className="max-w-md w-full space-y-6">
        <div>
          <Link
            href="/"
            className="text-gray-700 hover:text-black hover:underline flex items-center gap-2 justify-center font-medium text-sm sm:text-base mb-6"
          >
            <ChevronLeft className="w-5 h-5" />
            Back to Home
          </Link>
        </div>

        <Card className="shadow-xl border-2">
          <CardHeader className="text-center space-y-2">
            <div className="flex items-center justify-center w-14 h-14 sm:w-16 sm:h-16 bg-black rounded-full mb-2 mx-auto">
              <Lock className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
            </div>
            <CardTitle className="text-2xl sm:text-3xl font-bold text-gray-900">
              {passwordChangeRequired ? 'Set New Password' : 'Sign In'}
            </CardTitle>
            <CardDescription className="text-sm sm:text-base">
              {passwordChangeRequired
                ? 'Update your Active Directory password to continue'
                : 'Access your account and VPN instructions'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 sm:p-4 bg-destructive/15 border border-destructive/20 rounded-lg flex items-center gap-3 text-destructive">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <p className="text-sm sm:text-base font-medium">{error}</p>
              </div>
            )}

            {redirectTo && (
              <div className="p-3 sm:p-4 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-xs sm:text-sm">
                Please sign in to continue. You&apos;ll be redirected back to your requested page.
              </div>
            )}

            {passwordChangeRequired ? (
              <form onSubmit={handlePasswordChangeSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="passwordChangeUsername">Username</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                    <Input
                      type="text"
                      id="passwordChangeUsername"
                      value={credentials.username}
                      className="pl-10"
                      disabled
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="currentPassword">Current Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                    <Input
                      type="password"
                      id="currentPassword"
                      required
                      autoComplete="current-password"
                      value={passwordChange.currentPassword}
                      onChange={(e) => setPasswordChange({ ...passwordChange, currentPassword: e.target.value })}
                      className="pl-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="newPassword">New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                    <Input
                      type="password"
                      id="newPassword"
                      required
                      autoComplete="new-password"
                      value={passwordChange.newPassword}
                      onChange={(e) => {
                        setPasswordChangeIssues([]);
                        setPasswordChange({ ...passwordChange, newPassword: e.target.value });
                      }}
                      className="pl-10"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirmNewPassword">Confirm New Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                    <Input
                      type="password"
                      id="confirmNewPassword"
                      required
                      autoComplete="new-password"
                      value={passwordChange.confirmPassword}
                      onChange={(e) => setPasswordChange({ ...passwordChange, confirmPassword: e.target.value })}
                      className="pl-10"
                    />
                  </div>
                  {passwordChange.confirmPassword && !passwordChangePasswordsMatch && (
                    <p className="text-xs font-medium text-destructive">New passwords do not match.</p>
                  )}
                </div>

                {passwordChangeVisibleIssues.length > 0 && (
                  <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 sm:p-4 text-yellow-800">
                    <p className="text-sm font-semibold">Password requirements</p>
                    <ul className="mt-2 list-disc space-y-1 pl-5 text-xs sm:text-sm">
                      {passwordChangeVisibleIssues.map((issue) => (
                        <li key={issue}>{issue}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full"
                  size="lg"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Updating password...
                    </>
                  ) : (
                    <>
                      Update Password
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={loading}
                  className="w-full"
                  onClick={cancelPasswordChange}
                >
                  Back to Sign In
                </Button>
              </form>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username">Username</Label>
                  <div className="relative">
                    <User className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                    <Input
                      type="text"
                      id="username"
                      required
                      value={credentials.username}
                      onChange={(e) => setCredentials({ ...credentials, username: e.target.value })}
                      className="pl-10"
                      placeholder="billy bronco"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
                    <Input
                      type="password"
                      id="password"
                      required
                      value={credentials.password}
                      onChange={(e) => setCredentials({ ...credentials, password: e.target.value })}
                      className="pl-10"
                      placeholder="••••••••"
                    />
                  </div>
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 sm:p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-yellow-600 mt-0.5 shrink-0" />
                  <p className="text-xs sm:text-sm text-yellow-700">
                    This login is tied to the sdc.cpp domain. Use the credentials provided to you via email.
                  </p>
                </div>

                <div className="flex justify-center py-2">
                  <Turnstile
                    key={turnstileKey}
                    sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''}
                    onVerify={(token) => setTurnstileToken(token)}
                  />
                </div>

                <Button
                  type="submit"
                  disabled={loading}
                  className="w-full"
                  size="lg"
                >
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    <>
                      Sign In
                      <ArrowRight className="ml-2 h-5 w-5" />
                    </>
                  )}
                </Button>
              </form>
            )}
          </CardContent>
          <CardFooter className="flex flex-col gap-2 text-center text-xs sm:text-sm text-muted-foreground">
            <p>
              Don&apos;t have an account?{' '}
              <Link href="/" className="text-primary hover:underline font-medium">
                Request Access
              </Link>
            </p>
            <p>
              <Link href="/forgot-password" className="text-primary hover:underline font-medium">
                Forgot your password?
              </Link>
            </p>
            <div className="mt-4 pt-4 border-t w-full">
              Need help? Contact{' '}
              <a href="mailto:soc@cpp.edu" className="text-primary hover:underline font-medium">
                soc@cpp.edu
              </a>
            </div>
          </CardFooter>
        </Card>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-linear-to-b from-white to-gray-100 flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="animate-spin h-10 w-10 text-primary mx-auto" />
          <p className="text-muted-foreground font-medium">Loading...</p>
        </div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
