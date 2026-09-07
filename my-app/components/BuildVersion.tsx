'use client';

import useSWR from 'swr';

async function readBuildVersion(url: string): Promise<string | null> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('Build information unavailable');
  const data: { revision?: unknown } = await response.json();
  return typeof data.revision === 'string' && /^[a-f0-9]{7,40}$/i.test(data.revision)
    ? data.revision
    : null;
}

export default function BuildVersion() {
  const { data: revision } = useSWR('/api/version', readBuildVersion, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  });
  if (!revision) return null;
  return (
    <p className="mt-3 text-xs text-neutral-400">
      <a
        href={`https://github.com/xdkaine/uar-web-public/commit/${revision}`}
        target="_blank"
        rel="noopener noreferrer"
        title={`View build ${revision} on GitHub`}
        aria-label={`View build ${revision.slice(0, 7)} on GitHub (opens in a new tab)`}
        className="rounded-sm underline-offset-4 transition-colors hover:text-blue-400 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950"
      >
        Build <span className="font-mono">{revision.slice(0, 7)}</span>
      </a>
    </p>
  );
}
