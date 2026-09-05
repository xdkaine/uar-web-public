"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import * as m from "framer-motion/m";
import { LazyMotionBoundary } from "@/components/animations/LazyMotionBoundary";
import Turnstile from "react-turnstile";
import { fetchWithCsrf } from "@/lib/csrf";
import { PasswordResetSubmitButton } from "@/app/account/reset-password/PasswordResetSubmitButton";

function ForgotPasswordPageContent() {
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const turnstileToken = useRef("");
  const [turnstileKey, setTurnstileKey] = useState(0);

  useEffect(() => {
    document.title = "Forgot Password | User Access Request (UAR) Portal";
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setSuccess(false);

    try {
      const response = await fetchWithCsrf("/api/auth/request-password-reset", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, turnstileToken: turnstileToken.current }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to request password reset");
      }

      setSuccess(true);
      setEmail(""); // Clear the email field
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "An error occurred. Please try again.",
      );
      setTurnstileKey((prev: number) => prev + 1);
      turnstileToken.current = "";
    } finally {
      setLoading(false);
    }
  };

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
            <svg
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 19l-7-7 7-7"
              />
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
              <svg
                className="w-7 h-7 sm:w-8 sm:h-8 text-white"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
                />
              </svg>
            </m.div>
            <m.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
              className="text-2xl sm:text-3xl font-bold text-foreground mb-2"
            >
              Forgot Password?
            </m.h1>
            <m.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
              className="text-sm sm:text-base text-muted-foreground"
            >
              Enter your email address and we&apos;ll send you a link to reset
              your password
            </m.p>
          </div>

          {success ? (
            <div className="bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-900 rounded-lg p-4 sm:p-6 mb-6">
              <div className="flex items-start">
                <div className="shrink-0">
                  <svg
                    className="h-5 w-5 sm:h-6 sm:w-6 text-green-600 dark:text-green-400 mt-0.5"
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
                <div className="ml-3">
                  <h3 className="text-sm sm:text-base font-semibold text-green-900 mb-2">
                    Check your email
                  </h3>
                  <p className="text-xs sm:text-sm text-green-700 dark:text-green-200 mb-3">
                    If an account exists with this email, you will receive a
                    password reset link shortly. The link will expire in 1 hour.
                  </p>
                  <button
                    onClick={() => {
                      setSuccess(false);
                      setError("");
                    }}
                    className="text-xs sm:text-sm font-medium text-green-800 hover:text-green-900 hover:underline"
                  >
                    ← Send another email
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg">
                  <p className="text-xs sm:text-sm text-red-700 dark:text-red-200">
                    {error}
                  </p>
                </div>
              )}

              <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-lg p-3 sm:p-4 mb-6">
                <div className="flex items-start">
                  <svg
                    className="w-5 h-5 text-blue-600 dark:text-blue-400 mt-0.5 mr-2 sm:mr-3 shrink-0"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <p className="text-xs sm:text-sm text-blue-700 dark:text-blue-200">
                    For security reasons, we won&apos;t confirm if an account
                    exists with this email. If it does, you&apos;ll receive a
                    reset link.
                  </p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
                <div>
                  <label
                    htmlFor="email"
                    className="block text-xs sm:text-sm font-medium text-foreground/90 mb-2"
                  >
                    Email Address
                  </label>
                  <input
                    type="email"
                    id="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 sm:px-4 py-2.5 sm:py-3 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent bg-card text-foreground text-sm sm:text-base"
                    placeholder="SatonoDiamond@uma.cpp"
                    required
                  />
                </div>

                <div className="flex justify-center">
                  <Turnstile
                    key={turnstileKey}
                    sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ""}
                    onVerify={(token) => {
                      turnstileToken.current = token;
                    }}
                  />
                </div>

                <PasswordResetSubmitButton
                  loading={loading}
                  label="Send Reset Link"
                />
              </form>
            </>
          )}

          <m.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8 }}
            className="mt-4 sm:mt-6 text-center space-y-2"
          >
            <p className="text-xs sm:text-sm text-muted-foreground">
              Remember your password?{" "}
              <Link
                href="/login"
                className="text-foreground hover:underline font-medium"
              >
                Sign in
              </Link>
            </p>
          </m.div>
        </m.div>

        <m.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 }}
          className="mt-4 sm:mt-6 text-center text-xs sm:text-sm text-muted-foreground"
        >
          <p>Cal Poly Pomona Student SOC</p>
        </m.div>
      </m.div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <LazyMotionBoundary>
      <ForgotPasswordPageContent />
    </LazyMotionBoundary>
  );
}
