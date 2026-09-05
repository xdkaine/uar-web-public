import { describe, expect, it } from 'vitest';
import {
  CollectionQueryError,
  collectionFingerprint,
  collectionPage,
  decodeCollectionCursor,
  encodeCollectionCursor,
  parseCollectionDirection,
  parseCollectionLimit,
  parseCollectionSort,
} from './collections';

describe('admin collection cursors', () => {
  const fingerprint = collectionFingerprint({ search: 'ada', sort: 'createdAt', direction: 'desc' });

  it('round-trips stable duplicate-sort cursors using the id tie breaker', () => {
    const first = encodeCollectionCursor(fingerprint, new Date('2026-01-01T00:00:00.000Z'), 'first');
    const second = encodeCollectionCursor(fingerprint, new Date('2026-01-01T00:00:00.000Z'), 'second');
    expect(decodeCollectionCursor(first, fingerprint)).toEqual({ value: '2026-01-01T00:00:00.000Z', id: 'first' });
    expect(decodeCollectionCursor(second, fingerprint)?.id).toBe('second');
  });

  it('rejects malformed and query-mismatched cursors', () => {
    expect(() => decodeCollectionCursor('not-a-cursor', fingerprint)).toThrow(CollectionQueryError);
    expect(() => decodeCollectionCursor(encodeCollectionCursor('other', 'a', 'id'), fingerprint)).toThrow(CollectionQueryError);
  });

  it('validates allowlisted paging parameters', () => {
    expect(parseCollectionLimit('50')).toBe(50);
    expect(() => parseCollectionLimit('501')).toThrow(CollectionQueryError);
    expect(parseCollectionDirection('asc')).toBe('asc');
    expect(() => parseCollectionDirection('sideways')).toThrow(CollectionQueryError);
    expect(parseCollectionSort('name', ['createdAt', 'name'] as const, 'createdAt')).toBe('name');
  });

  it('creates a page without exposing an item beyond the requested limit', () => {
    const page = collectionPage({
      rows: [{ id: 'a', value: 'a' }, { id: 'b', value: 'b' }, { id: 'c', value: 'c' }],
      limit: 2,
      total: 3,
      summary: { all: 3 },
      fingerprint,
      cursorFor: (item) => item,
    });
    expect(page.items).toHaveLength(2);
    expect(page.pageInfo).toMatchObject({ total: 3, hasNext: true });
    expect(page.pageInfo.nextCursor).toBeTruthy();
  });
});
