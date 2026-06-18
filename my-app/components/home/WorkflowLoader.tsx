'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';

const LazyRequestWorkflow = dynamic(
  () => import('@/components/home/RequestWorkflow').then(mod => mod.RequestWorkflow),
  {
    ssr: false,
    loading: () => (
      <section className="mx-auto mt-16 max-w-5xl px-4 sm:px-6">
        <div className="rounded-3xl border border-gray-200 bg-white/95 p-6 text-center shadow-xl sm:p-10">
          <p className="text-sm font-medium text-gray-600">Loading workflow...</p>
        </div>
      </section>
    ),
  }
);

export function WorkflowLoader() {
  const [isOpen, setIsOpen] = useState(false);

  if (isOpen) {
    return <LazyRequestWorkflow />;
  }

  return (
    <section className="mx-auto mt-16 max-w-5xl px-4 sm:px-6">
      <div className="space-y-4 rounded-3xl border border-gray-200 bg-white/95 p-6 text-center shadow-xl sm:p-10">
        <span className="inline-flex items-center justify-center rounded-full bg-gray-900 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.25em] text-white">
          Request Workflow
        </span>
        <div className="mx-auto max-w-2xl space-y-2">
          <h3 className="text-2xl font-semibold text-gray-900">From request to access</h3>
          <p className="text-sm leading-relaxed text-gray-700 sm:text-base">
            See how requests move through email verification, director review, faculty activation, and credential delivery.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="inline-flex items-center justify-center rounded-lg bg-gray-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-gray-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900/70 focus-visible:ring-offset-2"
        >
          Show Workflow
        </button>
      </div>
    </section>
  );
}
