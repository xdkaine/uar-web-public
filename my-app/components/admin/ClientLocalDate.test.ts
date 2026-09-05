import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import { ClientLocalDate } from './ClientLocalDate';

afterEach(() => vi.restoreAllMocks());

it.each(['date', 'time', 'date-time'] as const)('keeps %s out of server markup until the browser supplies its locale', (format) => {
  for (const method of ['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString'] as const) {
    vi.spyOn(Date.prototype, method).mockImplementation(() => { throw new Error('Server locale must not be used'); });
  }
  expect(renderToString(createElement('span', { 'data-testid': 'localdate-result' },
    createElement(ClientLocalDate, { value: '2026-09-04T23:00:00Z', format }),
  ))).toBe('<span data-testid="localdate-result"></span>');
});
