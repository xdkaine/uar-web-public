'use client';

import { useEffect, useState } from 'react';

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatTime(value: Date): string {
  return value.toLocaleTimeString();
}

/** Formats in the viewer's timezone only after hydration. */
export function LogsLocalizedDateTime({ value }: { value: string }) {
  const [formatted, setFormatted] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setFormatted(formatDateTime(value)), 0);
    return () => window.clearTimeout(timer);
  }, [value]);

  return <time dateTime={value}>{formatted}</time>;
}

export function LogsLocalizedTime({ value }: { value: Date }) {
  const [formatted, setFormatted] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setFormatted(formatTime(value)), 0);
    return () => window.clearTimeout(timer);
  }, [value]);

  return <time dateTime={value.toISOString()}>{formatted}</time>;
}
