'use client';

import { useEffect, useState, type ReactNode } from 'react';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ACTION_IMPACT_REQUEST_EVENT,
  type ActionImpactInput,
  type ActionImpactItem,
  type QueuedImpact,
} from './actionImpactRequest';

interface ActionImpactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  items: readonly ActionImpactItem[];
  confirmLabel: string;
  cancelLabel?: string;
  working?: boolean;
  confirmDisabled?: boolean;
  destructive?: boolean;
  evidence?: ReactNode;
  input?: ActionImpactInput;
  inputValue?: string;
  onInputValueChange?: (value: string) => void;
  onConfirm: () => void | Promise<void>;
}

export function ActionImpactDialog({
  open,
  onOpenChange,
  title,
  description,
  items,
  confirmLabel,
  cancelLabel = 'Cancel',
  working = false,
  confirmDisabled = false,
  destructive = false,
  evidence,
  input,
  inputValue,
  onInputValueChange,
  onConfirm,
}: ActionImpactDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {items.length > 0 && <dl className="divide-y rounded-lg border bg-muted/20 text-sm">
          {items.map((item) => (
            <div key={item.label} className="grid gap-1 px-3 py-2.5 sm:grid-cols-[8rem_1fr] sm:gap-3">
              <dt className="font-medium text-muted-foreground">{item.label}</dt>
              <dd
                className={cn(
                  'min-w-0 break-words text-foreground',
                  item.tone === 'warning' && 'text-[var(--tone-warning-fg)]',
                  item.tone === 'danger' && 'font-medium text-destructive',
                )}
              >
                {item.value}
              </dd>
            </div>
          ))}
        </dl>}
        {input && (
          <div className="grid gap-2">
            <Label htmlFor="action-impact-value">{input.label}</Label>
            <Input
              id="action-impact-value"
              value={inputValue ?? ''}
              type={input.type ?? 'text'}
              autoComplete={input.type === 'password' ? 'new-password' : undefined}
              placeholder={input.placeholder}
              required={input.required}
              onChange={(event) => onInputValueChange?.(event.target.value)}
            />
          </div>
        )}
        {evidence && (
          <div className="rounded-lg border border-dashed bg-background px-3 py-2 text-xs text-muted-foreground">
            {evidence}
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={working}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={working || confirmDisabled}
            onClick={(event) => {
              event.preventDefault();
              void onConfirm();
            }}
            className={cn(destructive && 'bg-destructive text-white hover:bg-destructive/90')}
          >
            {working ? 'Working…' : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function ActionImpactDialogProvider() {
  const [queue, setQueue] = useState<QueuedImpact[]>([]);
  const current = queue[0];

  useEffect(() => {
    const handleRequest = (event: Event) => {
      const request = (event as CustomEvent<QueuedImpact>).detail;
      setQueue((pending) => [...pending, request]);
    };
    window.addEventListener(ACTION_IMPACT_REQUEST_EVENT, handleRequest);
    return () => window.removeEventListener(ACTION_IMPACT_REQUEST_EVENT, handleRequest);
  }, []);

  const finish = (confirmed: boolean) => {
    if (!current) return;
    current.resolve({ confirmed, value: confirmed && current.input ? current.value : null });
    setQueue((pending) => pending.slice(1));
  };

  if (!current) return null;
  return (
    <ActionImpactDialog
      open
      onOpenChange={(open) => { if (!open) finish(false); }}
      title={current.title}
      description={current.description}
      items={current.items ?? []}
      confirmLabel={current.confirmLabel ?? 'Continue'}
      cancelLabel={current.cancelLabel}
      destructive={current.destructive}
      evidence={current.evidence}
      input={current.input}
      inputValue={current.value}
      onInputValueChange={(value) => {
        setQueue((pending) => pending.map((item, index) => (
          index === 0 ? { ...item, value } : item
        )));
      }}
      confirmDisabled={Boolean(current.input?.required && !current.value.trim())}
      onConfirm={() => finish(true)}
    />
  );
}
