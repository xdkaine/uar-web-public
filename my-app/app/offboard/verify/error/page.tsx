import Link from 'next/link';

export default function OffboardVerifyErrorPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
      <div className="mx-auto max-w-md rounded-lg border border-red-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold text-gray-900">Confirmation Unavailable</h1>
        <p className="mt-3 text-sm leading-6 text-gray-600">
          This confirmation link is invalid, expired, or temporarily rate limited.
        </p>
        <Link href="/" className="mt-6 inline-flex h-10 items-center rounded-md bg-[#1e5631] px-4 text-sm font-medium text-white">
          Return Home
        </Link>
      </div>
    </main>
  );
}
