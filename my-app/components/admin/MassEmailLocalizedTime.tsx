'use client';

import { useEffect, useState } from 'react';

export default function MassEmailLocalizedTime({ value, timeOnly = false }: { value: string | Date; timeOnly?: boolean }) {
  const [formatted, setFormatted] = useState('');

  useEffect(() => {
    const date = new Date(value);
    const timer = window.setTimeout(() => {
      setFormatted(timeOnly ? date.toLocaleTimeString() : date.toLocaleString());
    }, 0);
    return () => window.clearTimeout(timer);
  }, [timeOnly, value]);

  return <>{formatted}</>;
}
