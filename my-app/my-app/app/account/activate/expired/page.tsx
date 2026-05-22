import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Activation Link Expired | User Access Request (UAR) Portal',
};

export default function ActivationExpiredPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full space-y-8">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-6">
          <div className="flex items-center mb-4">
            <svg className="w-8 h-8 text-yellow-600 mr-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <h2 className="text-2xl font-bold text-yellow-800">Activation Link Expired</h2>
          </div>

          <div className="space-y-4">
            <p className="text-yellow-800">
              This activation link has expired after 7 days.
            </p>

            <div className="bg-white rounded-md p-4 border border-yellow-300">
              <h3 className="font-semibold text-gray-900 mb-2">Good News!</h3>
              <p className="text-gray-700 text-sm">
                Your Active Directory account has already been created and is active.
                You just need to set your password.
              </p>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
              <h3 className="font-semibold text-blue-900 mb-2">Next Steps:</h3>
              <ol className="list-decimal list-inside space-y-2 text-sm text-blue-800">
                <li>Use the &quot;Forgot Password&quot; feature to set your password</li>
                <li>Enter the email address associated with your account</li>
                <li>Follow the password reset instructions in your email</li>
                <li>Log in with your new password</li>
              </ol>
            </div>

            <div className="flex flex-col space-y-3 mt-6">
              <Link
                href="/forgot-password"
                className="inline-block bg-green-600 text-white text-center px-6 py-3 rounded-md hover:bg-green-700 font-medium transition-colors"
              >
                Set Password via Forgot Password
              </Link>

              <Link
                href="/login"
                className="inline-block bg-gray-200 text-gray-700 text-center px-6 py-3 rounded-md hover:bg-gray-300 font-medium transition-colors"
              >
                Go to Login Page
              </Link>
            </div>

            <div className="mt-6 pt-6 border-t border-yellow-200">
              <h4 className="font-medium text-gray-900 mb-2">Need Help?</h4>
              <p className="text-sm text-gray-600">
                If you continue to experience issues, please contact the IT department for assistance.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
