'use client';

import * as React from 'react';
import { Check, ChevronsUpDown, Loader2, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command';
import { Button } from '@/components/ui/button';

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
  /** Trailing meta rendered on the right, e.g. an "Automated" badge. */
  hint?: React.ReactNode;
  /** Secondary line under the label, e.g. an OU breadcrumb. */
  meta?: React.ReactNode;
  keywords?: string[];
  /** Options sharing a group render under one heading, in group order. */
  group?: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  loading?: boolean;
  disabled?: boolean;
  /** Show a clear button when a value is selected. */
  clearable?: boolean;
  id?: string;
  'aria-label'?: string;
  className?: string;
  /** Render the trigger's selected label (defaults to the option label). */
  renderSelected?: (option: ComboboxOption | undefined) => React.ReactNode;
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  emptyMessage = 'No matches found.',
  loading = false,
  disabled = false,
  clearable = false,
  id,
  'aria-label': ariaLabel,
  className,
  renderSelected,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState('');
  const triggerRef = React.useRef<HTMLButtonElement>(null);

  const selected = React.useMemo(
    () => options.find((option) => option.value === value) ?? undefined,
    [options, value]
  );

  const grouped = React.useMemo(() => {
    const groups = new Map<string, ComboboxOption[]>();
    for (const option of options) {
      const key = option.group ?? '';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(option);
    }
    return groups;
  }, [options]);

  const handleClear = (event: React.MouseEvent) => {
    event.stopPropagation();
    onValueChange('');
    setSearch('');
    triggerRef.current?.focus();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="relative w-full">
        <PopoverTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={ariaLabel}
            disabled={disabled}
            id={id}
            className={cn(
              'h-10 w-full justify-between px-3 font-normal',
              !selected && 'text-muted-foreground',
              className
            )}
          >
            <span className="min-w-0 flex-1 truncate text-left">
              {loading ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Loading options…
                </span>
              ) : selected ? (
                renderSelected ? (
                  renderSelected(selected)
                ) : (
                  selected.label
                )
              ) : (
                placeholder
              )}
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {clearable && selected && !disabled && (
                <span aria-hidden="true" className="w-[18px]" />
              )}
              <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
            </span>
          </Button>
        </PopoverTrigger>
        {clearable && selected && !disabled && (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={handleClear}
            className="absolute right-8 top-1/2 -translate-y-1/2 rounded-sm p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <PopoverContent className="w-(--radix-popover-trigger-width) p-0" align="start">
        <Command shouldFilter={!loading}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            {loading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : options.length === 0 ? (
              <CommandEmpty>{emptyMessage}</CommandEmpty>
            ) : (
              <CommandEmpty>{emptyMessage}</CommandEmpty>
            )}
            {[...grouped.entries()].map(([group, groupOptions], index) => (
              <React.Fragment key={group}>
                {index > 0 && <CommandSeparator />}
                <CommandGroup
                  heading={group || undefined}
                  className={group ? '[&_[cmdk-group-heading]]:px-3' : undefined}
                >
                  {groupOptions.map((option) => {
                    const isSelected = option.value === value;
                    return (
                      <CommandItem
                        key={option.value}
                        value={`${option.label} ${option.keywords?.join(' ') ?? ''} ${option.value}`}
                        onSelect={() => {
                          onValueChange(option.value);
                          setSearch('');
                          setOpen(false);
                        }}
                        className="items-start gap-2.5 py-2"
                      >
                        <Check
                          className={cn(
                            'mt-0.5 h-4 w-4 shrink-0',
                            isSelected ? 'opacity-100' : 'opacity-0'
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate font-medium">{option.label}</span>
                            {option.hint}
                          </span>
                          {option.description && (
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {option.description}
                            </span>
                          )}
                          {option.meta && (
                            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                              {option.meta}
                            </span>
                          )}
                        </span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </React.Fragment>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
