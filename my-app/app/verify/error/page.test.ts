import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';

const { query } = vi.hoisted(() => ({ query: { reason: null as string | null } }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(query.reason === null ? '' : { reason: query.reason }) }));
import VerifyErrorPage from './page';

it.each([
  ['missing-token', 'Missing Verification Token'],
  ['invalid-token', 'Invalid Token'],
  ['expired', 'Link Expired'],
  ['server-error', 'Server Error'],
  [null, 'Server Error'],
  ['unknown', 'Server Error'],
  ['constructor', 'Server Error'],
  ['__proto__', 'Server Error'],
])('preserves useful guidance for reason %s', (reason, title) => {
  query.reason = reason;
  const html = renderToStaticMarkup(createElement(VerifyErrorPage));
  expect(html).toContain(title);
  expect(html).toContain('href="/"');
  expect(html).toContain('href="mailto:soc@cpp.edu"');
  expect(html.includes('Submit a new access request if the link has expired')).toBe(reason === 'expired');
});
