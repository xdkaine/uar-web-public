'use client';

import { useState } from 'react';
import { Plus, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import LdapPathInput from './LdapPathInput';

interface LdapDnListInputProps {
  id?: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}

/** Keeps every LDAP distinguished name as an indivisible token. */
export default function LdapDnListInput({ id, value, onChange, placeholder }: LdapDnListInputProps) {
  const [draft, setDraft] = useState('');

  const addDraft = () => {
    const candidate = draft.trim();
    if (!candidate) return;
    onChange(Array.from(new Set([...value, candidate])));
    setDraft('');
  };

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5 rounded-md border bg-muted/20 p-2">
          {value.map((dn) => (
            <Badge key={dn} variant="secondary" className="max-w-full gap-1 py-1 pl-2 pr-1 font-mono font-normal">
              <span className="break-all">{dn}</span>
              <button
                type="button"
                aria-label={`Remove ${dn}`}
                className="shrink-0 rounded-sm p-0.5 hover:bg-muted-foreground/20"
                onClick={() => onChange(value.filter((entry) => entry !== dn))}
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <LdapPathInput
            id={id}
            value={draft}
            onChange={setDraft}
            suggestType="group"
            testValues={value}
            placeholder={placeholder}
          />
        </div>
        <Button type="button" variant="outline" size="sm" disabled={!draft.trim()} onClick={addDraft}>
          <Plus className="h-4 w-4" />
          Add group
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Add one complete distinguished name at a time. Commas inside a DN are preserved.
      </p>
    </div>
  );
}
