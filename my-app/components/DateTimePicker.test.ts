import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, expect, it, vi } from 'vitest';
import DateTimePicker from './DateTimePicker';

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each([
  {},
  { minDate: new Date('2026-09-05T23:00:00Z') },
  { maxDate: new Date('2026-09-03T23:00:00Z') },
])('does not put server-local date text into the initial field or closed calendar (%o)', limits => {
  const localFormat = vi.spyOn(Date.prototype, 'toLocaleString');
  const render = () => renderToStaticMarkup(createElement(DateTimePicker, {
    value: '2026-09-04T23:00:00Z', label: 'Expires', onChange: () => {}, ...limits,
  }));
  localFormat.mockReturnValue('Server local time');
  const server = render();
  localFormat.mockReturnValue('Visitor local time');
  expect(render()).toBe(server);
  expect(server).not.toContain('Server local time');
  expect(server).not.toContain('role="dialog"');
  expect(server).not.toContain('Previous month');
});

it('does not render clock-dependent calendar content before opening', () => {
  vi.useFakeTimers();
  const render = () => renderToStaticMarkup(createElement(DateTimePicker, { value: '', onChange: () => {} }));
  vi.setSystemTime(new Date('2026-08-31T23:59:59Z'));
  const before = render();
  vi.setSystemTime(new Date('2026-09-01T00:00:01Z'));
  expect(render()).toBe(before);
});
