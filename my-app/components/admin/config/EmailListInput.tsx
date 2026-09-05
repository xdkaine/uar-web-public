'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { X } from 'lucide-react';
import { isValidAddress } from './email-list-validation';

interface EmailListInputProps {
  id?: string;
  /** Comma-separated address list; the canonical draft representation. */
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

/**
 * Address-list editor rendering entries as selectable, deletable tokens.
 * The value stays a comma-separated string so existing config persistence is
 * unchanged; typing an address and pressing Enter, Tab, comma, or leaving the
 * field commits one chip. Invalid entries are rejected with inline feedback.
 */
export default function EmailListInput({ id, value, onChange, placeholder }: EmailListInputProps) {
  const [draft, setDraft] = useState('');
  const [invalid, setInvalid] = useState(false);

  const addresses = () =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter(Boolean);

  const commitDraft = () => {
    const candidate = draft.trim();
    if (!candidate) return;
    if (!isValidAddress(candidate)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    const next = Array.from(new Set([...addresses(), candidate.toLowerCase()]));
    onChange(next.join(','));
    setDraft('');
  };

  const remove = (target: string) => {
    onChange(addresses().filter((entry) => entry !== target).join(','));
  };

  return (
    <div className="space-y-1">
      <div className="flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring">
        {addresses().map((address) => (
          <Badge key={address} variant="secondary" className="gap-1 pr-1 font-normal">
            {address}
            <button
              type="button"
              aria-label={`Remove ${address}`}
              className="rounded-sm p-0.5 hover:bg-muted-foreground/20"
              onClick={() => remove(address)}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <Input
          id={id}
          className="h-6 flex-1 min-w-[12rem] border-0 bg-transparent p-1 shadow-none focus-visible:ring-0"
          value={draft}
          placeholder={addresses().length === 0 ? placeholder : ''}
          autoComplete="off"
          onChange={(e) => {
            setInvalid(false);
            const raw = e.target.value;
            if (raw.includes(',')) {
              setDraft(raw);
              // Commit complete comma segments immediately; keep trailing fragment.
              const segments = raw.split(',');
              const trailing = segments.pop() ?? '';
              const validNew = segments.map((s) => s.trim()).filter((s) => s && isValidAddress(s));
              if (validNew.length > 0) {
                const next = Array.from(new Set([...addresses(), ...validNew.map((s) => s.toLowerCase())]));
                onChange(next.join(','));
              }
              setDraft(trailing);
            } else {
              setDraft(raw);
            }
          }}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Tab') {
              e.preventDefault();
              commitDraft();
            } else if (e.key === 'Backspace' && !draft && addresses().length > 0) {
              const current = addresses();
              onChange(current.slice(0, -1).join(','));
            }
          }}
        />
      </div>
      {invalid && (
        <p className="text-xs text-destructive">Enter a valid address like name@example.org</p>
      )}
    </div>
  );
}
