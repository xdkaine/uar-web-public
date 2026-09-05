'use client';

import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { fetchWithCsrf } from '@/lib/csrf';
import { fetchJson } from '@/lib/client-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Loader2, PlugZap, Check, X, ChevronRight } from 'lucide-react';
import { dnBreadcrumbSegments, splitDnRdns } from '@/lib/ldap/dn-format';

interface Suggestion {
  dn: string;
  name: string;
}

interface ProbeResult {
  found: boolean;
  kind: string | null;
  name: string | null;
  error: string | null;
}

interface ProbeLine {
  id: string;
  dn: string;
  ok: boolean;
  detail: string;
}

interface LdapPathInputProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  /** Enables live autocomplete for the segment being typed. */
  suggestType?: 'group' | 'ou';
  /** Complete DNs to probe instead of the current input value. */
  testValues?: string[];
  placeholder?: string;
  className?: string;
}

const DEBOUNCE_MS = 300;

function breadcrumbItems(value: string) {
  const occurrences = new Map<string, number>();
  return dnBreadcrumbSegments(value).map((segment) => {
    const occurrence = occurrences.get(segment) ?? 0;
    occurrences.set(segment, occurrence + 1);
    return { id: `${segment}:${occurrence}`, segment };
  });
}

/**
 * DN input with directory autocomplete and a "Test path" probe. By default the
 * value holds one complete distinguished name and is probed whole. List
 * editors pass complete entries through testValues so commas are never used
 * as separators.
 */
export default function LdapPathInput({
  id,
  value,
  onChange,
  suggestType,
  testValues,
  placeholder,
  className,
}: LdapPathInputProps) {
  const [items, setItems] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loadingItems, setLoadingItems] = useState(false);
  const [debouncedTerm, setDebouncedTerm] = useState('');
  const [testing, setTesting] = useState(false);
  const [probeLines, setProbeLines] = useState<ProbeLine[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const probeRun = useRef(0);

  const term = suggestType ? value.trim() : '';

  useEffect(() => {
    if (!suggestType || term.length < 2) {
      setDebouncedTerm('');
      setItems([]);
      setOpen(false);
      setLoadingItems(false);
      return undefined;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLoadingItems(true);
    debounceRef.current = setTimeout(() => setDebouncedTerm(term), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [term, suggestType]);

  useSWR<{ suggestions?: Suggestion[] }>(
    suggestType && debouncedTerm
      ? `/api/admin/config/directory/suggest?type=${suggestType}&term=${encodeURIComponent(debouncedTerm)}`
      : null,
    fetchJson,
    {
      keepPreviousData: true,
      onSuccess: (data) => {
        setItems(Array.isArray(data.suggestions) ? data.suggestions : []);
        setOpen(true);
        setLoadingItems(false);
      },
      onError: () => {
        setItems([]);
        setOpen(false);
        setLoadingItems(false);
      },
    }
  );

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const entriesToTest = (): string[] => {
    if (testValues) return testValues.map((dn) => dn.trim()).filter(Boolean);
    const whole = value.trim();
    return whole ? [whole] : [];
  };

  const runTest = async () => {
    const dns = entriesToTest();
    if (dns.length === 0) return;
    const runId = ++probeRun.current;
    setTesting(true);
    setProbeLines(null);
    try {
      const results = await Promise.all(
        dns.slice(0, 8).map(async (dn, index) => {
          try {
            const res = await fetchWithCsrf('/api/admin/config/directory/probe', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ dn }),
            });
            const data = await res.json();
            const probe: ProbeResult | undefined = data?.probe;
            if (probe?.found) {
              return { id: `${runId}:${index}`, dn, ok: true, detail: `${probe.kind ?? 'object'}${probe.name ? ` · ${probe.name}` : ''}` };
            }
            return { id: `${runId}:${index}`, dn, ok: false, detail: probe?.error ?? 'Not found' };
          } catch {
            return { id: `${runId}:${index}`, dn, ok: false, detail: 'Probe request failed' };
          }
        })
      );
      const overflow = dns.length > 8 ? [{ id: `${runId}:overflow`, dn: `+${dns.length - 8} more`, ok: false, detail: 'test the first entries individually' }] : [];
      setProbeLines([...results, ...overflow]);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div ref={containerRef} className="space-y-1.5">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            id={id}
            className={`font-mono text-sm ${className ?? ''}`}
            value={value}
            placeholder={placeholder}
            autoComplete="off"
            onChange={(e) => onChange(e.target.value)}
            onFocus={() => items.length > 0 && setOpen(true)}
          />
          {open && items.length > 0 && (
            <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-md border bg-popover py-1 text-sm shadow-md">
              {items.map((item) => (
                <li key={item.dn}>
                  <button
                    type="button"
                    className="w-full px-3 py-1.5 text-left hover:bg-accent"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onChange(item.dn);
                      setOpen(false);
                    }}
                  >
                    <span className="font-medium">{item.name}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground break-all">{item.dn}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={testing || entriesToTest().length === 0}
          onClick={runTest}
          title="Verify this path against the directory"
        >
          {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlugZap className="h-4 w-4" />}
          Test
        </Button>
      </div>

      {loadingItems && <p className="text-xs text-muted-foreground">Searching directory…</p>}

      {!loadingItems && value.trim() && splitDnRdns(value).length > 0 && (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1 rounded border bg-muted/20 px-2 py-1.5 text-xs">
          <span title={value.trim()} className="flex flex-wrap items-center gap-x-1">
            {breadcrumbItems(value).map((item, index) => (
              <span key={item.id} className="inline-flex items-center gap-x-1">
                {index > 0 && <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />}
                <span
                  className={
                    index === splitDnRdns(value).length - 1
                      ? 'font-medium text-foreground'
                      : 'text-muted-foreground'
                  }
                >
                  {item.segment}
                </span>
              </span>
            ))}
          </span>
          <span className="ml-auto font-mono text-[10px] text-muted-foreground/70 break-all max-w-full" title={value.trim()}>
            {value.trim()}
          </span>
        </div>
      )}

      {probeLines && (
        <ul className="space-y-1 rounded border bg-muted/30 p-2 text-xs">
          {probeLines.map((line) => (
            <li key={line.id} className="flex items-start gap-1.5">
              {line.ok ? (
                <Check className="mt-0.5 h-3.5 w-3.5 text-green-600 dark:text-green-400" />
              ) : (
                <X className="mt-0.5 h-3.5 w-3.5 text-destructive" />
              )}
              <Badge variant={line.ok ? 'default' : 'destructive'} className="shrink-0">
                {line.ok ? line.detail : line.ok === false && line.detail ? 'invalid' : '?'}
              </Badge>
              <span className="font-mono break-all">{line.dn}</span>
              {!line.ok && line.detail && line.detail !== 'invalid' && (
                <span className="text-muted-foreground">— {line.detail}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
