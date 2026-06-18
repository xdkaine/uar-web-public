import { describe, expect, it } from 'vitest';
import { validateOffboardExtensionSchedule } from './offboard-extension-schedule';

describe('validateOffboardExtensionSchedule', () => {
  const now = new Date('2026-06-12T12:00:00.000Z');

  it('accepts and sorts up to five custom reminders before the deadline', () => {
    const result = validateOffboardExtensionSchedule(
      '2026-06-20T12:00:00.000Z',
      [
        '2026-06-18T12:00:00.000Z',
        '2026-06-14T12:00:00.000Z',
      ],
      now
    );

    expect(result.newDeadline.toISOString()).toBe('2026-06-20T12:00:00.000Z');
    expect(result.reminderDates.map(date => date.toISOString())).toEqual([
      '2026-06-14T12:00:00.000Z',
      '2026-06-18T12:00:00.000Z',
    ]);
  });

  it('rejects deadlines that are not in the future', () => {
    expect(() => validateOffboardExtensionSchedule(now, [], now))
      .toThrow('New deadline must be in the future');
  });

  it('requires custom reminders to be at least 24 hours after the extension', () => {
    expect(() => validateOffboardExtensionSchedule(
      '2026-06-20T12:00:00.000Z',
      ['2026-06-12T12:15:00.000Z'],
      now
    )).toThrow('Reminder dates must be at least 24 hours after the extension is created');

    expect(validateOffboardExtensionSchedule(
      '2026-06-20T12:00:00.000Z',
      ['2026-06-13T12:00:00.000Z'],
      now
    ).reminderDates[0].toISOString()).toBe('2026-06-13T12:00:00.000Z');
  });

  it('rejects duplicate, expired, and post-deadline reminders', () => {
    expect(() => validateOffboardExtensionSchedule(
      '2026-06-20T12:00:00.000Z',
      ['2026-06-14T12:00:00.000Z', '2026-06-14T12:00:00.000Z'],
      now
    )).toThrow('Reminder dates must be unique');

    expect(() => validateOffboardExtensionSchedule(
      '2026-06-20T12:00:00.000Z',
      ['2026-06-10T12:00:00.000Z'],
      now
    )).toThrow('Reminder dates must be in the future');

    expect(() => validateOffboardExtensionSchedule(
      '2026-06-20T12:00:00.000Z',
      ['2026-06-21T12:00:00.000Z'],
      now
    )).toThrow('Reminder dates must be before the new deadline');
  });

  it('rejects more than five reminders', () => {
    expect(() => validateOffboardExtensionSchedule(
      '2026-06-30T12:00:00.000Z',
      Array.from({ length: 6 }, (_, index) => `2026-06-${13 + index}T12:00:00.000Z`),
      now
    )).toThrow('No more than 5 custom reminders may be scheduled');
  });
});
