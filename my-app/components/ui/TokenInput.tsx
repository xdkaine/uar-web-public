'use client';

import { useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { X } from 'lucide-react';

import { mergeTokens } from '@/lib/token-list';
import { cn } from '@/lib/utils';

interface TokenInputProps {
  id?: string;
  values: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
}

export function TokenInput({ id, values, onChange, placeholder, ariaLabel, className }: TokenInputProps) {
  const [draft, setDraft] = useState('');

  const commit = (value = draft) => {
    const next = mergeTokens(values, value);
    if (next.length !== values.length) onChange(next);
    setDraft('');
  };

  const removeAt = (index: number) => {
    onChange(values.filter((_, candidateIndex) => candidateIndex !== index));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ',', ';', 'Tab'].includes(event.key) && draft.trim()) {
      if (event.key !== 'Tab') event.preventDefault();
      commit();
      return;
    }
    if (event.key === 'Backspace' && !draft && values.length > 0) {
      removeAt(values.length - 1);
    }
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData('text');
    if (!/[\s,;]/.test(pasted)) return;
    event.preventDefault();
    commit(`${draft} ${pasted}`);
  };

  return (
    <div className={cn('flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-input bg-card px-2.5 py-2 focus-within:ring-2 focus-within:ring-ring', className)}>
      {values.map((value, index) => (
        <span key={value} className="inline-flex max-w-full items-center gap-1 rounded-md border border-primary/20 bg-primary/10 px-2 py-1 text-xs font-medium text-foreground">
          <span className="truncate">{value}</span>
          <button type="button" onClick={() => removeAt(index)} className="rounded-sm text-muted-foreground hover:text-foreground focus:outline-hidden focus:ring-1 focus:ring-ring" aria-label={`Remove ${value}`}>
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onBlur={() => draft.trim() && commit()}
        className="min-w-36 flex-1 bg-transparent px-1 py-0.5 text-sm outline-hidden placeholder:text-muted-foreground"
        placeholder={values.length === 0 ? placeholder : 'Add another…'}
        aria-label={ariaLabel}
      />
    </div>
  );
}
