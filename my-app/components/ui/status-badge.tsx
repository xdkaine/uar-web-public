import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

export type StatusTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'critical';
export type StatusEmphasis = 'soft' | 'solid' | 'outline';

const toneClasses: Record<StatusTone, Record<StatusEmphasis, string>> = {
  neutral: {
    soft: 'border-[var(--tone-neutral-border)] bg-[var(--tone-neutral-bg)] text-[var(--tone-neutral-fg)]',
    solid: 'border-[var(--tone-neutral-solid)] bg-[var(--tone-neutral-solid)] text-[var(--tone-neutral-solid-fg)]',
    outline: 'border-[var(--tone-neutral-border)] bg-transparent text-[var(--tone-neutral-fg)]',
  },
  info: {
    soft: 'border-[var(--tone-info-border)] bg-[var(--tone-info-bg)] text-[var(--tone-info-fg)]',
    solid: 'border-[var(--tone-info-solid)] bg-[var(--tone-info-solid)] text-[var(--tone-info-solid-fg)]',
    outline: 'border-[var(--tone-info-border)] bg-transparent text-[var(--tone-info-fg)]',
  },
  success: {
    soft: 'border-[var(--tone-success-border)] bg-[var(--tone-success-bg)] text-[var(--tone-success-fg)]',
    solid: 'border-[var(--tone-success-solid)] bg-[var(--tone-success-solid)] text-[var(--tone-success-solid-fg)]',
    outline: 'border-[var(--tone-success-border)] bg-transparent text-[var(--tone-success-fg)]',
  },
  warning: {
    soft: 'border-[var(--tone-warning-border)] bg-[var(--tone-warning-bg)] text-[var(--tone-warning-fg)]',
    solid: 'border-[var(--tone-warning-solid)] bg-[var(--tone-warning-solid)] text-[var(--tone-warning-solid-fg)]',
    outline: 'border-[var(--tone-warning-border)] bg-transparent text-[var(--tone-warning-fg)]',
  },
  danger: {
    soft: 'border-[var(--tone-danger-border)] bg-[var(--tone-danger-bg)] text-[var(--tone-danger-fg)]',
    solid: 'border-[var(--tone-danger-solid)] bg-[var(--tone-danger-solid)] text-[var(--tone-danger-solid-fg)]',
    outline: 'border-[var(--tone-danger-border)] bg-transparent text-[var(--tone-danger-fg)]',
  },
  critical: {
    soft: 'border-[var(--tone-critical-border)] bg-[var(--tone-critical-bg)] text-[var(--tone-critical-fg)]',
    solid: 'border-[var(--tone-critical-solid)] bg-[var(--tone-critical-solid)] text-[var(--tone-critical-solid-fg)]',
    outline: 'border-[var(--tone-critical-border)] bg-transparent text-[var(--tone-critical-fg)]',
  },
};

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  emphasis?: StatusEmphasis;
}

export function StatusBadge({
  tone = 'neutral',
  emphasis = 'soft',
  className,
  ...props
}: StatusBadgeProps) {
  return (
    <span
      data-slot="status-badge"
      data-tone={tone}
      data-emphasis={emphasis}
      className={cn(
        'inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium leading-5',
        toneClasses[tone][emphasis],
        className,
      )}
      {...props}
    />
  );
}
