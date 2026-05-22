import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = process.env;

async function loadCookieSecurity() {
  vi.resetModules();
  return import('./cookie-security');
}

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe('shouldUseSecureCookies', () => {
  it('uses secure cookies by default', async () => {
    process.env = { ...ORIGINAL_ENV, SESSION_COOKIE_ALLOW_INSECURE: undefined };
    const { shouldUseSecureCookies } = await loadCookieSecurity();

    expect(shouldUseSecureCookies()).toBe(true);
  });

  it('allows insecure cookies when explicitly configured', async () => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'development', SESSION_COOKIE_ALLOW_INSECURE: 'true' };
    const { shouldUseSecureCookies } = await loadCookieSecurity();

    expect(shouldUseSecureCookies()).toBe(false);
  });

  it('logs the production insecure-cookie warning only once per module load', async () => {
    process.env = { ...ORIGINAL_ENV, NODE_ENV: 'production', SESSION_COOKIE_ALLOW_INSECURE: 'true' };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { shouldUseSecureCookies } = await loadCookieSecurity();

    expect(shouldUseSecureCookies()).toBe(false);
    expect(shouldUseSecureCookies()).toBe(false);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});