'use client';

export class ClientQueryError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ClientQueryError';
    this.status = status;
  }
}

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const errorBody = await response.json() as { error?: string };
      if (errorBody.error) message = errorBody.error;
    } catch {
      // The HTTP status still supplies a useful error when the body is empty.
    }
    throw new ClientQueryError(message, response.status);
  }
  const body = await response.json().catch(() => null) as T | null;
  if (body === null) {
    throw new ClientQueryError('The server returned an empty response', response.status);
  }
  return body;
}
