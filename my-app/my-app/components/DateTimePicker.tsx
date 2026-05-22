'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DateTimePickerProps {
  value: string; // ISO datetime string (YYYY-MM-DDTHH:mm)
  onChange: (datetime: string) => void;
  label?: string;
  placeholder?: string;
  required?: boolean;
  minDate?: Date; // Minimum selectable date
  maxDate?: Date; // Maximum selectable date
  disabled?: boolean;
  className?: string;
}

export default function DateTimePicker({
  value,
  onChange,
  label,
  placeholder = 'Select date and time',
  required = false,
  minDate,
  maxDate,
  disabled = false,
  className = '',
}: DateTimePickerProps) {
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    if (value) {
      return new Date(value);
    }
    return new Date();
  });
  const [selectedDate, setSelectedDate] = useState(() => {
    if (value) {
      return value.split('T')[0];
    }
    return '';
  });
  const [selectedTime, setSelectedTime] = useState(() => {
    if (value) {
      return value.split('T')[1] || '12:00';
    }
    return '12:00';
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

  const formatDateTimeForDisplay = (datetimeStr: string) => {
    if (!datetimeStr) return '';
    try {
      const dt = new Date(datetimeStr);
      return dt.toLocaleString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
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
    const date = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
    if (!isDateDisabled(date)) {
      setSelectedDate(formatDateForInput(date));
    }
  };

  const navigateMonth = (direction: number) => {
    const newMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + direction, 1);
    setCalendarMonth(newMonth);
  };

  const handleConfirm = () => {
    if (selectedDate && selectedTime) {
      const datetime = `${selectedDate}T${selectedTime}`;
      onChange(datetime);
      setShowCalendar(false);
    }
  };

  const handleClear = () => {
    if (!required) {
      onChange('');
      setSelectedDate('');
      setSelectedTime('12:00');
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
          value={value ? formatDateTimeForDisplay(value) : ''}
          readOnly
          placeholder={placeholder}
          disabled={disabled}
          className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded-md text-gray-900 text-sm cursor-pointer focus:outline-none focus:ring-2 focus:ring-blue-500"
          onClick={() => !disabled && setShowCalendar(true)}
        />
        <button
          type="button"
          onClick={() => setShowCalendar(true)}
          disabled={disabled}
          className="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-md flex items-center justify-center disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          title="Select date and time"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </button>
        {value && !required && !disabled && (
          <button
            type="button"
            onClick={handleClear}
            className="px-3 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-md text-sm font-semibold transition-colors"
            title="Clear date and time"
          >
            ×
          </button>
        )}
      </div>

      <Dialog open={showCalendar} onOpenChange={setShowCalendar}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Select Date and Time</DialogTitle>
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
              const isSelected = selectedDate === formatDateForInput(date);
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

          <div className="pt-4 border-t border-gray-200">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Time
            </label>
            <input
              type="time"
              value={selectedTime}
              onChange={(e) => setSelectedTime(e.target.value)}
              className="w-full px-4 py-2 border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-gray-900"
            />
          </div>

          {selectedDate && selectedTime && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-sm text-blue-900">
                <span className="font-semibold">Selected:</span>{' '}
                {new Date(`${selectedDate}T${selectedTime}`).toLocaleString('en-US', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                  hour12: true,
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
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!selectedDate}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
            >
              Confirm
            </button>
          </div>
        </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
