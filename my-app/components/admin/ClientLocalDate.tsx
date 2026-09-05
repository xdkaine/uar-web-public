'use client';

import { useSyncExternalStore } from 'react';

type DateFormat = 'date' | 'time' | 'date-time';

interface ClientLocalDateProps {
  value: string | Date;
  format?: DateFormat;
  includeSeconds?: boolean;
}

function subscribeToLocaleChange(onChange: () => void) {
  window.addEventListener('languagechange', onChange);
  return () => window.removeEventListener('languagechange', onChange);
}

// The server and first hydration pass agree; only the browser formats local time.
function getServerSnapshot() {
  return '';
}

export function ClientLocalDate({ value, format = 'date-time', includeSeconds = false }: ClientLocalDateProps) {
  const formatted = useSyncExternalStore(subscribeToLocaleChange, () => {
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) {
      return '';
    }

    if (format === 'date') {
      return date.toLocaleDateString();
    }
    if (format === 'time') {
      return date.toLocaleTimeString();
    }
    return includeSeconds
      ? date.toLocaleString(undefined, { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      : date.toLocaleString();
  }, getServerSnapshot);

  return <>{formatted}</>;
}
