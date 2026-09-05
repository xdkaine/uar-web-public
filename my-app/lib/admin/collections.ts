import { createHash } from 'crypto';

export interface CollectionPage<T> {
  items: T[];
  pageInfo: {
    limit: number;
    total: number;
    nextCursor: string | null;
    hasNext: boolean;
  };
  summary: Record<string, number>;
}

export type CollectionDirection = 'asc' | 'desc';

export class CollectionQueryError extends Error {}

type CursorPayload = {
  v: 1;
  fingerprint: string;
  value: string;
  id: string;
};

/** A deterministic query identifier prevents cursors being replayed against another filter/sort. */
export function collectionFingerprint(query: Record<string, string | number | boolean | null | undefined>): string {
  const stable = Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .sort(([left], [right]) => left.localeCompare(right));
  return createHash('sha256').update(JSON.stringify(stable)).digest('base64url');
}

export function parseCollectionLimit(value: string | null, defaultLimit = 25, maxLimit = 100): number {
  if (value === null) return defaultLimit;
  if (!/^\d+$/.test(value)) throw new CollectionQueryError('limit must be a positive integer');
  const limit = Number(value);
  if (limit < 1 || limit > maxLimit) throw new CollectionQueryError(`limit must be between 1 and ${maxLimit}`);
  return limit;
}

export function parseCollectionDirection(value: string | null): CollectionDirection {
  if (value === null) return 'desc';
  if (value === 'asc' || value === 'desc') return value;
  throw new CollectionQueryError('direction must be asc or desc');
}

export function parseCollectionSort<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  if (value === null) return fallback;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  throw new CollectionQueryError(`sort must be one of: ${allowed.join(', ')}`);
}

export function encodeCollectionCursor(fingerprint: string, value: Date | string, id: string): string {
  const payload: CursorPayload = {
    v: 1,
    fingerprint,
    value: value instanceof Date ? value.toISOString() : value,
    id,
  };
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCollectionCursor(cursor: string | null, fingerprint: string): { value: string; id: string } | null {
  if (cursor === null) return null;
  try {
    const payload = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as CursorPayload;
    if (payload.v !== 1 || payload.fingerprint !== fingerprint || typeof payload.value !== 'string' || typeof payload.id !== 'string') {
      throw new Error('invalid cursor');
    }
    return { value: payload.value, id: payload.id };
  } catch {
    throw new CollectionQueryError('cursor is malformed or does not match this query');
  }
}

export function collectionPage<T>(input: {
  rows: T[];
  limit: number;
  total: number;
  summary: Record<string, number>;
  fingerprint: string;
  cursorFor: (item: T) => { value: Date | string; id: string };
}): CollectionPage<T> {
  const hasNext = input.rows.length > input.limit;
  const items = hasNext ? input.rows.slice(0, input.limit) : input.rows;
  const last = items.at(-1);
  const nextCursor = hasNext && last
    ? (() => {
        const cursor = input.cursorFor(last);
        return encodeCollectionCursor(input.fingerprint, cursor.value, cursor.id);
      })()
    : null;
  return { items, pageInfo: { limit: input.limit, total: input.total, hasNext, nextCursor }, summary: input.summary };
}
