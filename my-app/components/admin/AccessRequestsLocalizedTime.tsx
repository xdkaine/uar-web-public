'use client';
import { useEffect, useState } from 'react';

function useLocalizedValue(value: string, format: (value: string) => string) {
  const [formatted, setFormatted] = useState('');
  useEffect(() => { const timer = window.setTimeout(() => setFormatted(format(value)), 0); return () => window.clearTimeout(timer); }, [format, value]);
  return formatted;
}
const formatDateTime = (value: string) => new Date(value).toLocaleString();
const formatDate = (value: string) => new Date(value).toLocaleDateString();
const formatTime = (value: string) => new Date(value).toLocaleTimeString();
const formatExpiry = (value: string) => { const date = new Date(value); return { date: date.toLocaleDateString(), time: date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) }; };
export function AccessRequestDateTime({ value }: { value: string }) { const formatted = useLocalizedValue(value, formatDateTime); return <time dateTime={value}>{formatted}</time>; }
export function AccessRequestDate({ value }: { value: string }) { const formatted = useLocalizedValue(value, formatDate); return <time dateTime={value}>{formatted}</time>; }
export function AccessRequestTime({ value }: { value: Date }) { const formatted = useLocalizedValue(value.toISOString(), formatTime); return <time dateTime={value.toISOString()}>{formatted}</time>; }
export function AccessRequestExpiry({ value }: { value: string }) { const [formatted, setFormatted] = useState<{ date: string; time: string } | null>(null); useEffect(() => { const timer = window.setTimeout(() => setFormatted(formatExpiry(value)), 0); return () => window.clearTimeout(timer); }, [value]); if (!formatted) return null; return <div className="relative inline-block group"><span className="font-medium cursor-help">{formatted.date}</span><div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-foreground text-background text-xs rounded-lg whitespace-nowrap opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-opacity duration-200 pointer-events-none z-50">Expires: {formatted.date} at {formatted.time}<div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-foreground" /></div></div>; }
