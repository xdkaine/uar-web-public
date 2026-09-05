import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClientQueryError, fetchJson } from './client-query';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchJson', () => {
  it('returns parsed data for a successful response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ value: 42 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    ));

    await expect(fetchJson<{ value: number }>('/api/example')).resolves.toEqual({ value: 42 });
  });

  it('preserves the HTTP status and server message for an error response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'Sign-in required' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      })
    ));

    await expect(fetchJson('/api/example')).rejects.toEqual(
      expect.objectContaining<ClientQueryError>({
        name: 'ClientQueryError',
        message: 'Sign-in required',
        status: 401,
      })
    );
  });

  it('rejects an empty successful response instead of returning invalid data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 204 })));

    await expect(fetchJson('/api/example')).rejects.toEqual(
      expect.objectContaining({ status: 204 })
    );
  });
});
