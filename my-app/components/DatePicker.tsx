'use client';

import { useId, useState, useSyncExternalStore } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DatePickerProps {
  value: string; // ISO date string (YYYY-MM-DD)
  onChange: (date: string) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  minDate?: Date; // Minimum selectable date
  maxDate?: Date; // Maximum selectable date
  disabled?: boolean;
  className?: string;
}

const getDaysInMonth = (date: Date) => {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
};

const getFirstDayOfMonth = (date: Date) => {
  return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
};

const formatDateForInput = (date: Date) => {
  // This is a calendar day, not an instant to convert into another time zone.
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const formatDateForDisplay = (dateStr: string) => {
  if (!dateStr) return '';
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '';
  }
};

function subscribeToLocaleChanges(onChange: () => void) {
  window.addEventListener('languagechange', onChange);
  return () => window.removeEventListener('languagechange', onChange);
}

function emptyServerSnapshot() {
  return '';
}

function LocalMonthLabel({ value }: { value: Date }) {
  const formatted = useSyncExternalStore(
    subscribeToLocaleChanges,
    () => value.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    emptyServerSnapshot,
  );
  return <>{formatted}</>;
}

function LocalSelectedDate({ value }: { value: string }) {
  const formatted = useSyncExternalStore(
    subscribeToLocaleChanges,
    () => new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    }),
    emptyServerSnapshot,
  );
  return <>{formatted}</>;
}

export default function DatePicker({
  value,
  onChange,
  label,
  placeholder = 'Select a date',
  required = false,
  minDate,
  maxDate,
  disabled = false,
  className = '',
}: DatePickerProps) {
  const inputId = useId();
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    if (value) {
      return new Date(value + 'T00:00:00');
    }
    // The real current month is chosen when the client opens the dialog.
    return new Date(0);
  });
  const displayValue = useSyncExternalStore(
    subscribeToLocaleChanges,
    () => value ? formatDateForDisplay(value) : '',
    emptyServerSnapshot,
  );
  const todayKey = useSyncExternalStore(
    subscribeToLocaleChanges,
    () => formatDateForInput(new Date()),
    emptyServerSnapshot,
  );

  const isDateDisabled = (date: Date) => {
    if (minDate) {
      const min = new Date(minDate);
      min.setHours(0, 0, 0, 0);
      if (date < min) return true;
    }
    if (maxDate) {
      const max = new Date(maxDate);
      max.setHours(0, 0, 0, 0);
      if (date > max) return true;
    }
    return false;
  };

  const selectDate = (day: number) => {
    const selectedDate = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
    if (!isDateDisabled(selectedDate)) {
      onChange(formatDateForInput(selectedDate));
      setShowCalendar(false);
    }
  };

  const navigateMonth = (direction: number) => {
    const newMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + direction, 1);
    setCalendarMonth(newMonth);
  };

  const handleClear = () => {
    if (!required) {
      onChange('');
    }
  };

  return (
    <>
      {label && (
        <label htmlFor={inputId} className="block text-sm font-medium text-foreground/90 mb-2">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      
      <div className={`flex gap-2 ${className}`}>
        <input
          id={inputId}
          type="text"
          value={displayValue}
          readOnly
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 px-3 sm:px-4 py-2 bg-muted/50 border-2 border-border rounded-lg text-foreground text-sm sm:text-base cursor-default"
        />
        <button
          type="button"
          onClick={() => setShowCalendar(true)}
          aria-label={`Calendar for ${label || 'date selection'}`}
          disabled={disabled}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="hidden sm:inline">Calendar</span>
        </button>
        {value && !required && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="px-3 py-2 bg-muted hover:bg-border text-foreground/90 rounded-lg text-sm font-semibold transition-colors"
            title="Clear date"
          >
            ×
          </button>
        )}
      </div>

      <Dialog open={showCalendar} onOpenChange={setShowCalendar}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Select Date</DialogTitle>
          </DialogHeader>
        <div className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              onClick={() => navigateMonth(-1)}
              aria-label="Previous month"
              className="p-2 hover:bg-muted rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h3 className="text-lg font-semibold text-foreground">
              <LocalMonthLabel value={calendarMonth} />
            </h3>
            <button
              type="button"
              onClick={() => navigateMonth(1)}
              aria-label="Next month"
              className="p-2 hover:bg-muted rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="text-center text-xs font-semibold text-muted-foreground py-2">
                {day}
              </div>
            ))}

            {Array.from({ length: getFirstDayOfMonth(calendarMonth) }).map((_, index) => (
              <div key={`empty-${index}`} className="aspect-square" />
            ))}

            {Array.from({ length: getDaysInMonth(calendarMonth) }).map((_, index) => {
              const day = index + 1;
              const date = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
              const isDisabled = isDateDisabled(date);
              const isSelected = value === formatDateForInput(date);
              const isToday = todayKey === formatDateForInput(date);

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => selectDate(day)}
                  disabled={isDisabled}
                  className={`aspect-square p-2 rounded-lg text-sm font-medium transition-colors ${
                    isDisabled
                      ? 'text-muted-foreground cursor-not-allowed'
                      : isSelected
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : isToday
                      ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-900 hover:bg-blue-200'
                      : 'text-foreground hover:bg-muted'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {value && (
            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-lg">
              <p className="text-sm text-blue-900">
                <span className="font-semibold">Selected Date:</span>{' '}
                <LocalSelectedDate value={value} />
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-4">
            <button
              type="button"
              onClick={() => setShowCalendar(false)}
              className="px-4 py-2 text-foreground/90 bg-muted rounded-lg hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            {value && (
              <button
                type="button"
                onClick={() => {
                  onChange(value);
                  setShowCalendar(false);
                }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Confirm
              </button>
            )}
          </div>
        </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
