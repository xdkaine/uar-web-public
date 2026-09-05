export interface TicketCategoryOption {
  value: string;
  label: string;
}

export const TICKET_CATEGORIES: readonly TicketCategoryOption[] = [
  { value: 'ACCOUNT', label: 'Account Issue' },
  { value: 'INFRASTRUCTURE', label: 'Infrastructure Issue' },
  { value: 'SDC', label: 'SDC (Student Data Center)' },
  { value: 'SOC', label: 'SOC (Security Operations Center)' },
] as const;

export const TICKET_CATEGORY_VALUES: readonly string[] =
  TICKET_CATEGORIES.map((option) => option.value);

/**
 * Topics whose tickets may carry a self-service "add me to a group"
 * membership request. Other topics route through review instead.
 */
export const GROUP_JOIN_CATEGORY_VALUES: readonly string[] = ['ACCOUNT'] as const;

export function isValidTicketCategory(value: string): boolean {
  return TICKET_CATEGORY_VALUES.includes(value);
}

export function isGroupJoinCategory(value: string): boolean {
  return GROUP_JOIN_CATEGORY_VALUES.includes(value);
}

export function ticketCategoryLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  return TICKET_CATEGORIES.find((option) => option.value === value)?.label ?? value;
}
