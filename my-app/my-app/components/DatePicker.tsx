'use client';

import { useState } from 'react';
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
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    if (value) {
      return new Date(value + 'T00:00:00');
    }
    return new Date();
  });

  const getDaysInMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (date: Date) => {
    return new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  };

  const formatDateForInput = (date: Date) => {
    return date.toISOString().split('T')[0];
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
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {label}
          {required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      
      <div className={`flex gap-2 ${className}`}>
        <input
          type="text"
          value={value ? formatDateForDisplay(value) : ''}
          readOnly
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 px-3 sm:px-4 py-2 bg-gray-50 border-2 border-gray-300 rounded-lg text-gray-900 text-sm sm:text-base cursor-default"
        />
        <button
          type="button"
          onClick={() => setShowCalendar(true)}
          disabled={disabled}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold flex items-center gap-2 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
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
            className="px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg text-sm font-semibold transition-colors"
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
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h3 className="text-lg font-semibold text-gray-900">
              {calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
            </h3>
            <button
              type="button"
              onClick={() => navigateMonth(1)}
              className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1">
            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => (
              <div key={day} className="text-center text-xs font-semibold text-gray-600 py-2">
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
              const isToday = formatDateForInput(new Date()) === formatDateForInput(date);

              return (
                <button
                  key={day}
                  type="button"
                  onClick={() => selectDate(day)}
                  disabled={isDisabled}
                  className={`aspect-square p-2 rounded-lg text-sm font-medium transition-colors ${
                    isDisabled
                      ? 'text-gray-300 cursor-not-allowed'
                      : isSelected
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : isToday
                      ? 'bg-blue-100 text-blue-900 hover:bg-blue-200'
                      : 'text-gray-900 hover:bg-gray-100'
                  }`}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {value && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-900">
                <span className="font-semibold">Selected Date:</span>{' '}
                {new Date(value + 'T00:00:00').toLocaleDateString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 mt-4">
            <button
              type="button"
              onClick={() => setShowCalendar(false)}
              className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
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
