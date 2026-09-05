import { describe, expect, it } from 'vitest';
import {
  GROUP_JOIN_CATEGORY_VALUES,
  TICKET_CATEGORIES,
  isGroupJoinCategory,
  isValidTicketCategory,
  ticketCategoryLabel,
} from './ticket-categories';

describe('ticket categories', () => {
  it('offers account and infrastructure topics alongside SDC and SOC', () => {
    expect(TICKET_CATEGORIES.map((option) => option.value)).toEqual([
      'ACCOUNT',
      'INFRASTRUCTURE',
      'SDC',
      'SOC',
    ]);
    expect(ticketCategoryLabel('ACCOUNT')).toBe('Account Issue');
    expect(ticketCategoryLabel('INFRASTRUCTURE')).toBe('Infrastructure Issue');
  });

  it('validates against the shared list only', () => {
    for (const option of TICKET_CATEGORIES) {
      expect(isValidTicketCategory(option.value)).toBe(true);
    }
    expect(isValidTicketCategory('NOPE')).toBe(false);
    expect(isValidTicketCategory('')).toBe(false);
  });

  it('limits group-join requests to account topics', () => {
    expect(GROUP_JOIN_CATEGORY_VALUES).toEqual(['ACCOUNT']);
    expect(isGroupJoinCategory('ACCOUNT')).toBe(true);
    expect(isGroupJoinCategory('INFRASTRUCTURE')).toBe(false);
    expect(isGroupJoinCategory('SDC')).toBe(false);
  });

  it('passes unknown stored values through for display', () => {
    expect(ticketCategoryLabel(null)).toBeNull();
    expect(ticketCategoryLabel(undefined)).toBeNull();
    expect(ticketCategoryLabel('LEGACY_VALUE')).toBe('LEGACY_VALUE');
  });
});
