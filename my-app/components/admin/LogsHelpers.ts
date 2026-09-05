import type { StatusTone } from '@/components/ui/status-badge';
import type { LogFilters } from './LogsTypes';

export const EMPTY_LOG_FILTERS: LogFilters = {
  action: '', category: '', username: '', targetType: '', eventKind: '', outcome: '', success: '', search: '', startDate: '', endDate: '',
};

const COUNT_FORMATTER = new Intl.NumberFormat('en-US');

export function normalizeLogFilterValue(value: string): string { return value === 'all' ? '' : value; }

export function activeLogFilterCount(filters: LogFilters): number {
  return Object.values(filters).filter((value) => Boolean(normalizeLogFilterValue(value))).length;
}

export function buildLogsQuery(filters: LogFilters, page: number, limit: number): string {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  (Object.entries(filters) as Array<[keyof LogFilters, string]>).forEach(([key, value]) => {
    const normalizedValue = normalizeLogFilterValue(value);
    if (normalizedValue) params.append(key, normalizedValue);
  });
  return params.toString();
}

export function updateLogsFilters(currentFilters: LogFilters, nextFilters: LogFilters, currentPage: number): { filters: LogFilters; page: number } {
  const filters = Object.fromEntries(
    (Object.entries(nextFilters) as Array<[keyof LogFilters, string]>)
      .map(([key, value]) => [key, normalizeLogFilterValue(value)]),
  ) as unknown as LogFilters;
  const changed = Object.keys(filters).some((key) => filters[key as keyof LogFilters] !== currentFilters[key as keyof LogFilters]);
  return { filters, page: changed ? 1 : currentPage };
}

export function formatLogCount(value: number): string { return COUNT_FORMATTER.format(value); }

export function getCategoryTone(category: string): StatusTone {
  if (category === 'blocklist') return 'danger';
  if (category === 'lifecycle' || category === 'sync_status') return 'warning';
  if (category === 'access_request' || category === 'event' || category === 'vpn' || category === 'support') return 'info';
  if (category === 'user' || category === 'group') return 'success';
  return 'neutral';
}

export function getActionDisplayName(action: string): string {
  return action.split('_').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
}

export function getLogOutcomePresentation(outcome: string | undefined, success: boolean): { label: string; tone: StatusTone } {
  if (!outcome) return success ? { label: 'Success', tone: 'success' } : { label: 'Failed', tone: 'danger' };
  if (outcome === 'success') return { label: 'Success', tone: 'success' };
  if (outcome === 'failure' || outcome === 'denied') return { label: getActionDisplayName(outcome), tone: 'danger' };
  if (outcome === 'pending' || outcome === 'rollback') return { label: getActionDisplayName(outcome), tone: 'warning' };
  if (outcome === 'skipped') return { label: 'Skipped', tone: 'neutral' };
  return { label: getActionDisplayName(outcome), tone: 'neutral' };
}
