import { afterEach, expect, it, vi } from 'vitest';
import { fetchWithCsrf, invalidateCsrfTokenCache } from './csrf';

afterEach(() => {
  invalidateCsrfTokenCache();
  vi.unstubAllGlobals();
});

it('fetches and attaches the CSRF token for an initial login POST', async () => {
  vi.stubGlobal('window', { location: { pathname: '/login' } });
  vi.stubGlobal('document', { cookie: '' });
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ csrfToken: 'fixture-csrf' }))
    .mockResolvedValueOnce(Response.json({ error: 'Invalid credentials' }, { status: 401 }));
  vi.stubGlobal('fetch', fetchMock);

  const response = await fetchWithCsrf('/api/auth/login', { method: 'POST', body: '{}' });

  expect(response.status).toBe(401);
  expect(fetchMock).toHaveBeenNthCalledWith(1, '/api/csrf-token', expect.anything());
  expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/auth/login', expect.objectContaining({
    headers: { 'x-csrf-token': 'fixture-csrf' },
  }));
});
