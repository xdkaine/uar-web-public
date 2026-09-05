'use client';

import { useEffect, useState } from 'react';

type DateStyle = 'date' | 'dateTime';

function formatDate(value: string, style: DateStyle): string {
  const date = new Date(value);
  return style === 'date' ? date.toLocaleDateString() : date.toLocaleString();
}

/** Uses the visitor's locale only after hydration, avoiding an SSR/client mismatch. */
export function LocalizedDateTime({ value, style = 'dateTime' }: { value: string; style?: DateStyle }) {
  const [formatted, setFormatted] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setFormatted(formatDate(value, style)), 0);
    return () => window.clearTimeout(timer);
  }, [style, value]);
  return <time dateTime={value}>{formatted}</time>;
}

export function LocalizedRelativeTime({ value }: { value: string }) {
  const [formatted, setFormatted] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
      if (minutes < 1) setFormatted('just now');
      else if (minutes < 60) setFormatted(`${minutes}m ago`);
      else if (minutes < 24 * 60) setFormatted(`${Math.round(minutes / 60)}h ago`);
      else if (minutes < 7 * 24 * 60) setFormatted(`${Math.round(minutes / (24 * 60))}d ago`);
      else setFormatted(new Date(value).toLocaleDateString());
    }, 0);
    return () => window.clearTimeout(timer);
  }, [value]);
  return <time dateTime={value}>{formatted}</time>;
}
