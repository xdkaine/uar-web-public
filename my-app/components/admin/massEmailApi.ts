import { fetchWithCsrf } from '@/lib/csrf';

export async function callJson(url: string, body: Record<string, unknown>, method = 'POST') {
  const response = await fetchWithCsrf(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}
