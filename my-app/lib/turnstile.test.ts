import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { verifyTurnstileToken } from './turnstile';
import { appLogger } from './logger';

vi.mock('./logger', () => ({ appLogger: { error: vi.fn(), warn: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'synthetic-provider-secret');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('verifyTurnstileToken', () => {
  it.each([400, 401, 429, 500, 503])('rejects HTTP %s even when the body claims success', async status => {
    const response = Response.json({ success: true }, { status });
    const readBody = vi.spyOn(response, 'json');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    expect(await verifyTurnstileToken('synthetic-challenge')).toBe(false);
    expect(readBody).not.toHaveBeenCalled();
    const logs = JSON.stringify([vi.mocked(appLogger.warn).mock.calls, vi.mocked(appLogger.error).mock.calls]);
    expect(logs).not.toContain('synthetic-provider-secret');
    expect(logs).not.toContain('synthetic-challenge');
  });

  it('accepts successful verification and preserves the provider form contract', async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ success: true }));
    vi.stubGlobal('fetch', request);
    expect(await verifyTurnstileToken('synthetic-challenge')).toBe(true);
    const [url, options] = request.mock.calls[0];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(options.method).toBe('POST');
    expect([...options.body.entries()]).toEqual([
      ['secret', 'synthetic-provider-secret'], ['response', 'synthetic-challenge'],
    ]);
  });

  it('rejects an ordinary provider denial', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: false, 'error-codes': ['invalid-input-response'] })));
    expect(await verifyTurnstileToken('synthetic-challenge')).toBe(false);
  });

  it('rejects malformed response JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not JSON')));
    expect(await verifyTurnstileToken('synthetic-challenge')).toBe(false);
  });

  it('rejects transport failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Synthetic transport failure')));
    expect(await verifyTurnstileToken('synthetic-challenge')).toBe(false);
  });

  it.each(['secret', 'token'])('does not send a request when the %s is missing', async missing => {
    if (missing === 'secret') vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    const request = vi.fn();
    vi.stubGlobal('fetch', request);
    expect(await verifyTurnstileToken(missing === 'token' ? '' : 'synthetic-challenge')).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
});
