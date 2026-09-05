import type { ReactNode } from 'react';

export interface ActionImpactItem {
  label: string;
  value: ReactNode;
  tone?: 'default' | 'warning' | 'danger';
}

export interface ActionImpactInput {
  label: string;
  type?: 'text' | 'password' | 'url' | 'number';
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
}

export interface ActionImpactRequest {
  title: string;
  description: string;
  items?: readonly ActionImpactItem[];
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  evidence?: ReactNode;
  input?: ActionImpactInput;
}

export interface ActionImpactResult {
  confirmed: boolean;
  value: string | null;
}

export interface QueuedImpact extends ActionImpactRequest {
  value: string;
  resolve: (result: ActionImpactResult) => void;
}

export const ACTION_IMPACT_REQUEST_EVENT = 'uar:action-impact-request';

export function requestActionImpact(request: ActionImpactRequest): Promise<ActionImpactResult> {
  if (typeof window === 'undefined') {
    return Promise.resolve({ confirmed: false, value: null });
  }

  return new Promise((resolve) => {
    window.dispatchEvent(new CustomEvent<QueuedImpact>(ACTION_IMPACT_REQUEST_EVENT, {
      detail: { ...request, value: request.input?.defaultValue ?? '', resolve },
    }));
  });
}
