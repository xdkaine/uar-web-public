import type { ResolutionSource } from './MassEmailTypes';

export function statusTone(status: string) {
  if (status === 'completed' || status === 'sent') return 'bg-green-100 dark:bg-green-950/60 text-green-800';
  if (status === 'active' || status === 'pending_send' || status === 'sending') return 'bg-blue-100 dark:bg-blue-950/60 text-blue-800';
  if (status === 'failed' || status === 'cancelled') return 'bg-red-100 dark:bg-red-950/60 text-red-800';
  if (status === 'delivery_unknown' || status === 'reconciliation_required') return 'bg-amber-100 dark:bg-amber-950/60 text-amber-800';
  if (status === 'skipped') return 'bg-amber-100 dark:bg-amber-950/60 text-amber-800';
  return 'bg-muted text-muted-foreground';
}

export function formatReason(reason?: string) {
  return reason ? reason.replace(/_/g, ' ') : '';
}

export function sourceSummary(sources: ResolutionSource[] = []) {
  const labels = new Set<string>();
  for (const source of sources) {
    if (source.label) labels.add(source.label);
  }
  return labels.size > 0 ? Array.from(labels).join(', ') : 'No source recorded';
}

export function normalizeSources(value: unknown): ResolutionSource[] {
  if (!Array.isArray(value)) return [];
  const sources: ResolutionSource[] = [];
  for (const source of value) {
    const normalized = {
      label: typeof source?.label === 'string' ? source.label : '',
      type: typeof source?.type === 'string' ? source.type : '',
    };
    if (normalized.label || normalized.type) sources.push(normalized);
  }
  return sources;
}
