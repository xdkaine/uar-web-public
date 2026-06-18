function parseDateInput(value: string | Date, fieldName: string): Date {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${fieldName} must be a valid date and time`);
  }
  return date;
}

export const OFFBOARD_EXTENSION_REMINDER_MIN_LEAD_HOURS = 24;
const OFFBOARD_EXTENSION_REMINDER_MIN_LEAD_MS =
  OFFBOARD_EXTENSION_REMINDER_MIN_LEAD_HOURS * 60 * 60 * 1000;

export function getMinimumOffboardExtensionReminderDate(now = new Date()) {
  return new Date(now.getTime() + OFFBOARD_EXTENSION_REMINDER_MIN_LEAD_MS);
}

export function isOffboardExtensionReminderScheduleValid(
  extensionCreatedAt: Date,
  scheduledFor: Date
) {
  return scheduledFor >= getMinimumOffboardExtensionReminderDate(extensionCreatedAt);
}

export function validateOffboardExtensionSchedule(
  newDeadlineInput: string | Date,
  reminderDateInputs: Array<string | Date> = [],
  now = new Date()
) {
  const newDeadline = parseDateInput(newDeadlineInput, 'New deadline');
  if (newDeadline <= now) {
    throw new Error('New deadline must be in the future');
  }

  if (reminderDateInputs.length > 5) {
    throw new Error('No more than 5 custom reminders may be scheduled');
  }

  const reminderDates = reminderDateInputs
    .map((value, index) => parseDateInput(value, `Reminder ${index + 1}`))
    .sort((a, b) => a.getTime() - b.getTime());

  const uniqueReminderTimes = new Set(reminderDates.map(date => date.getTime()));
  if (uniqueReminderTimes.size !== reminderDates.length) {
    throw new Error('Reminder dates must be unique');
  }

  for (const reminderDate of reminderDates) {
    if (reminderDate <= now) {
      throw new Error('Reminder dates must be in the future');
    }
    if (!isOffboardExtensionReminderScheduleValid(now, reminderDate)) {
      throw new Error(
        `Reminder dates must be at least ${OFFBOARD_EXTENSION_REMINDER_MIN_LEAD_HOURS} hours after the extension is created`
      );
    }
    if (reminderDate >= newDeadline) {
      throw new Error('Reminder dates must be before the new deadline');
    }
  }

  return { newDeadline, reminderDates };
}
