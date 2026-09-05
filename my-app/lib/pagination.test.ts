import { describe, expect, it } from 'vitest';

import { paginationItems } from './pagination';

describe('paginationItems', () => {
  it('shows every page for short result sets', () => {
    expect(paginationItems(3, 6)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('anchors the first and last page around a compact current-page window', () => {
    expect(paginationItems(6, 12)).toEqual([1, 'ellipsis', 5, 6, 7, 'ellipsis', 12]);
  });

  it('clamps out-of-range page inputs', () => {
    expect(paginationItems(99, 10)).toEqual([1, 'ellipsis', 9, 10]);
  });
});
