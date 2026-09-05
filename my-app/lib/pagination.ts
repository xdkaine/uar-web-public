export type PaginationItem = number | 'ellipsis';

/** Compact, stable page-number window with first/last anchors. */
export function paginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  const total = Math.max(1, Math.floor(totalPages));
  const current = Math.min(total, Math.max(1, Math.floor(currentPage)));
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);

  const pages = new Set([1, total, current - 1, current, current + 1]);
  const ordered = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
  const result: PaginationItem[] = [];
  ordered.forEach((page, index) => {
    const previous = ordered[index - 1];
    if (previous !== undefined && page - previous > 1) result.push('ellipsis');
    result.push(page);
  });
  return result;
}
