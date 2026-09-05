import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DatePicker from './DatePicker';

afterEach(() => vi.useRealTimers());

describe('DatePicker initial server output', () => {
  it.each(['', '2026-09-04'])('does not render the calendar or clock-dependent text before opening (%s)', (value) => {
    vi.useFakeTimers();
    const render = () => renderToStaticMarkup(createElement(DatePicker, { value, label: 'Start date', onChange: () => {} }));
    vi.setSystemTime(new Date('2026-08-31T23:59:59Z'));
    const beforeMidnight = render();
    vi.setSystemTime(new Date('2026-09-01T00:00:01Z'));
    expect(render()).toBe(beforeMidnight);
    expect(beforeMidnight).not.toContain('role="dialog"');
    expect(beforeMidnight).not.toContain('Previous month');
    expect(beforeMidnight).not.toContain('Selected Date:');
  });
});
