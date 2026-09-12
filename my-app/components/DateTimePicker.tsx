'use client';

import { useEffect, useId, useMemo, useState, useSyncExternalStore } from 'react';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Clock3,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';

interface DateTimePickerProps {
  value: string;
  onChange: (datetime: string) => void;
  label?: string;
  ariaLabel?: string;
  placeholder?: string;
  required?: boolean;
  minDate?: Date;
  maxDate?: Date;
  disabled?: boolean;
  className?: string;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const HOURS = Array.from({ length: 12 }, (_, index) => String(index + 1));
const MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));

function formatLocalDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatLocalTime(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function parseValue(value: string) {
  if (!value) return { date: '', time: '12:00', parsed: null as Date | null };

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return { date: '', time: '12:00', parsed: null as Date | null };
  }

  return {
    date: formatLocalDate(parsed),
    time: formatLocalTime(parsed),
    parsed,
  };
}

function getTimeParts(time: string) {
  const [hourValue = '12', minute = '00'] = time.split(':');
  const hour24 = Number(hourValue);

  return {
    hour: String(hour24 % 12 || 12),
    minute,
    period: hour24 >= 12 ? 'PM' : 'AM',
  };
}

function composeTime(hour: string, minute: string, period: string) {
  const hour12 = Number(hour);
  const hour24 = period === 'PM'
    ? (hour12 % 12) + 12
    : hour12 % 12;

  return `${String(hour24).padStart(2, '0')}:${minute}`;
}

function formatDateTimeForDisplay(value: string) {
  const { parsed } = parseValue(value);
  if (!parsed) return '';

  return parsed.toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

const getDaysInMonth = (date: Date) => (
  new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
);

const getFirstDayOfMonth = (date: Date) => (
  new Date(date.getFullYear(), date.getMonth(), 1).getDay()
);

function LocalDateTimeText({ value, placeholder }: { value: string; placeholder: string }) {
  const [formatted, setFormatted] = useState('');
  useEffect(() => {
    setFormatted(formatDateTimeForDisplay(value));
  }, [value]);
  return <>{value ? formatted : placeholder}</>;
}

function LocalMonthLabel({ value }: { value: Date }) {
  const formatted = useSyncExternalStore(
    subscribeToLocaleChanges,
    () => value.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }),
    emptyServerSnapshot,
  );
  return <>{formatted}</>;
}

function subscribeToLocaleChanges(onChange: () => void) {
  window.addEventListener('languagechange', onChange);
  return () => window.removeEventListener('languagechange', onChange);
}

function emptyServerSnapshot() {
  return '';
}

function DateTimeCalendar({ calendarMonth, isDateDisabled, onSelectDate, onShiftMonth, selectedDate, todayKey }: {
  calendarMonth: Date;
  isDateDisabled: (date: Date) => boolean;
  onSelectDate: (day: number) => void;
  onShiftMonth: (direction: number) => void;
  selectedDate: string;
  todayKey: string;
}) {
  return <div className="rounded-xl border p-3">
    <div className="mb-3 flex items-center justify-between gap-3">
      <Button type="button" size="icon-sm" variant="ghost" onClick={() => onShiftMonth(-1)} aria-label="Previous month"><ChevronLeft className="size-4" /></Button>
      <p className="text-sm font-semibold"><LocalMonthLabel value={calendarMonth} /></p>
      <Button type="button" size="icon-sm" variant="ghost" onClick={() => onShiftMonth(1)} aria-label="Next month"><ChevronRight className="size-4" /></Button>
    </div>
    <div className="grid grid-cols-7 gap-1">
      {WEEKDAYS.map(day => <div key={day} className="py-1 text-center text-[0.7rem] font-medium text-muted-foreground">{day}</div>)}
      {Array.from({ length: getFirstDayOfMonth(calendarMonth) }).map((_, index) => <div key={`empty-${index}`} className="aspect-square" />)}
      {Array.from({ length: getDaysInMonth(calendarMonth) }).map((_, index) => {
        const day = index + 1;
        const date = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
        const dateValue = formatLocalDate(date);
        const isDisabled = isDateDisabled(date);
        const isSelected = selectedDate === dateValue;
        const isToday = todayKey === dateValue;
        return <button key={day} type="button" onClick={() => onSelectDate(day)} disabled={isDisabled} aria-pressed={isSelected} className={cn('aspect-square rounded-md text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', isDisabled && 'cursor-not-allowed text-muted-foreground/35', !isDisabled && !isSelected && 'hover:bg-accent hover:text-accent-foreground', isToday && !isSelected && 'bg-accent text-accent-foreground', isSelected && 'bg-primary text-primary-foreground hover:bg-primary/90')}>{day}</button>;
      })}
    </div>
  </div>;
}

function DateTimeFields({ selectedTime, onChange }: { selectedTime: string; onChange: (value: string) => void }) {
  const timeParts = getTimeParts(selectedTime);
  return <div className="space-y-2"><Label className="flex items-center gap-2"><Clock3 className="size-4" />Time</Label><div className="grid grid-cols-[1fr_auto_1fr_1fr] items-center gap-2">
    <Select value={timeParts.hour} onValueChange={hour => onChange(composeTime(hour, timeParts.minute, timeParts.period))}><SelectTrigger className="w-full" aria-label="Hour"><SelectValue /></SelectTrigger><SelectContent position="popper" collisionPadding={12} className="z-[80] max-h-[min(18rem,var(--radix-select-content-available-height))]">{HOURS.map(hour => <SelectItem key={hour} value={hour}>{hour}</SelectItem>)}</SelectContent></Select>
    <span className="font-semibold text-muted-foreground">:</span>
    <Select value={timeParts.minute} onValueChange={minute => onChange(composeTime(timeParts.hour, minute, timeParts.period))}><SelectTrigger className="w-full" aria-label="Minute"><SelectValue /></SelectTrigger><SelectContent position="popper" collisionPadding={12} className="z-[80] max-h-[min(18rem,var(--radix-select-content-available-height))]">{MINUTES.map(minute => <SelectItem key={minute} value={minute}>{minute}</SelectItem>)}</SelectContent></Select>
    <Select value={timeParts.period} onValueChange={period => onChange(composeTime(timeParts.hour, timeParts.minute, period))}><SelectTrigger className="w-full" aria-label="AM or PM"><SelectValue /></SelectTrigger><SelectContent position="popper" collisionPadding={12} className="z-[80] max-h-[min(18rem,var(--radix-select-content-available-height))]"><SelectItem value="AM">AM</SelectItem><SelectItem value="PM">PM</SelectItem></SelectContent></Select>
  </div></div>;
}

function useDateTimePickerState({ value, onChange, required, minDate, maxDate }: Pick<DateTimePickerProps, 'value' | 'onChange' | 'required' | 'minDate' | 'maxDate'>) {
  const fieldId = useId();
  const [showCalendar, setShowCalendar] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => parseValue(value).parsed || new Date(0));
  const [selectedDate, setSelectedDate] = useState(() => parseValue(value).date);
  const [selectedTime, setSelectedTime] = useState(() => parseValue(value).time);
  const todayKey = useSyncExternalStore(subscribeToLocaleChanges, () => formatLocalDate(new Date()), emptyServerSnapshot);
  const selectedDateTime = useMemo(() => {
    if (!selectedDate || !selectedTime) return null;
    const original = parseValue(value);
    // Preserve the selected occurrence of a repeated DST hour when editing.
    if (original.parsed && original.date === selectedDate && original.time === selectedTime) return original.parsed;
    const parsed = new Date(`${selectedDate}T${selectedTime}`);
    return Number.isNaN(parsed.getTime()) || formatLocalDate(parsed) !== selectedDate || formatLocalTime(parsed) !== selectedTime ? null : parsed;
  }, [selectedDate, selectedTime, value]);
  const selectionError = useMemo(() => {
    if (!selectedDateTime) return null;
    if (minDate && selectedDateTime < minDate) return 'min' as const;
    if (maxDate && selectedDateTime > maxDate) return 'max' as const;
    return null;
  }, [maxDate, minDate, selectedDateTime]);
  const isDateDisabled = (date: Date) => {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    return Boolean((minDate && dayEnd < minDate) || (maxDate && dayStart > maxDate));
  };
  const setCalendarOpen = (open: boolean) => {
    if (open) {
      const nextValue = parseValue(value);
      setSelectedDate(nextValue.date);
      setSelectedTime(nextValue.time);
      setCalendarMonth(nextValue.parsed || new Date());
    }
    setShowCalendar(open);
  };
  const selectDate = (day: number) => {
    const date = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), day);
    if (!isDateDisabled(date)) setSelectedDate(formatLocalDate(date));
  };
  const navigateMonth = (direction: number) => setCalendarMonth(previous => new Date(previous.getFullYear(), previous.getMonth() + direction, 1));
  const handleConfirm = () => {
    if (!selectedDateTime || selectionError) return;
    onChange(selectedDateTime.toISOString());
    setShowCalendar(false);
  };
  const handleClear = () => {
    if (required) return;
    onChange('');
    setSelectedDate('');
    setSelectedTime('12:00');
  };
  return { calendarMonth, fieldId, handleClear, handleConfirm, isDateDisabled, navigateMonth, selectedDate, selectedDateTime, selectedTime, selectionError, selectDate, setCalendarOpen, setSelectedTime, showCalendar, todayKey };
}

function DateTimeDialog({ calendarMonth, handleConfirm, isDateDisabled, maxDate, minDate, navigateMonth, selectedDate, selectedDateTime, selectedTime, selectionError, selectDate, setCalendarOpen, setSelectedTime, showCalendar, todayKey }: {
  calendarMonth: Date;
  handleConfirm: () => void;
  isDateDisabled: (date: Date) => boolean;
  maxDate?: Date;
  minDate?: Date;
  navigateMonth: (direction: number) => void;
  selectedDate: string;
  selectedDateTime: Date | null;
  selectedTime: string;
  selectionError: 'min' | 'max' | null;
  selectDate: (day: number) => void;
  setCalendarOpen: (open: boolean) => void;
  setSelectedTime: (time: string) => void;
  showCalendar: boolean;
  todayKey: string;
}) {
  const selectionMessage = selectionError === 'min'
    ? <>Choose a time on or after <LocalDateTimeText value={minDate!.toISOString()} placeholder="the configured minimum" />.</>
    : selectionError === 'max'
      ? <>Choose a time on or before <LocalDateTimeText value={maxDate!.toISOString()} placeholder="the configured maximum" />.</>
      : selectedDateTime?.toLocaleString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true, timeZoneName: 'longOffset' });

  return <Dialog open={showCalendar} onOpenChange={setCalendarOpen}>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
      <DialogHeader><DialogTitle>Select date and time</DialogTitle><DialogDescription>Time zone: {Intl.DateTimeFormat().resolvedOptions().timeZone}. The UTC equivalent is shown below.</DialogDescription></DialogHeader>
      <div className="space-y-5"><DateTimeCalendar calendarMonth={calendarMonth} isDateDisabled={isDateDisabled} onSelectDate={selectDate} onShiftMonth={navigateMonth} selectedDate={selectedDate} todayKey={todayKey} /><DateTimeFields selectedTime={selectedTime} onChange={setSelectedTime} />{selectedDateTime && <div className={cn('rounded-lg border px-3 py-2 text-sm', selectionError ? 'border-destructive/40 bg-destructive/5 text-destructive' : 'bg-muted/40 text-foreground')}>{selectionMessage}</div>}</div>
      {selectedDateTime && <p className="text-sm text-muted-foreground">UTC: {selectedDateTime.toISOString().replace('T', ' ').replace('.000Z', ' UTC')}</p>}
      {selectedDate && !selectedDateTime && <p role="alert" className="text-sm text-destructive">This local time does not exist because the clock changes. Choose another time.</p>}
      <DialogFooter><Button type="button" variant="outline" onClick={() => setCalendarOpen(false)}>Cancel</Button><Button type="button" onClick={handleConfirm} disabled={!selectedDateTime || Boolean(selectionError)}>Confirm date and time</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

export default function DateTimePicker({
  value,
  onChange,
  label,
  ariaLabel,
  placeholder = 'Select date and time',
  required = false,
  minDate,
  maxDate,
  disabled = false,
  className = '',
}: DateTimePickerProps) {
  const { calendarMonth, fieldId, handleClear, handleConfirm, isDateDisabled, navigateMonth, selectedDate, selectedDateTime, selectedTime, selectionError, selectDate, setCalendarOpen, setSelectedTime, showCalendar, todayKey } = useDateTimePickerState({ value, onChange, required, minDate, maxDate });

  return (
    <div className={cn('space-y-2', className)}>
      {label && (
        <Label htmlFor={fieldId}>
          {label}
          {required && <span className="ml-1 text-destructive">*</span>}
        </Label>
      )}

      <div className="flex min-w-0 gap-2">
        <Button
          id={fieldId}
          type="button"
          variant="outline"
          disabled={disabled}
          aria-label={ariaLabel || label || placeholder}
          aria-haspopup="dialog"
          onClick={() => setCalendarOpen(true)}
          className={cn(
            'h-auto min-h-9 min-w-0 flex-1 justify-start whitespace-normal px-3 py-2 text-left font-normal',
            !value && 'text-muted-foreground'
          )}
        >
          <CalendarDays className="size-4 shrink-0" />
          <span className="min-w-0 truncate">
            <LocalDateTimeText value={value} placeholder={placeholder} />
          </span>
        </Button>
        {value && !required && !disabled && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            onClick={handleClear}
            aria-label={`Clear ${label || ariaLabel || 'date and time'}`}
          >
            <X className="size-4" />
          </Button>
        )}
      </div>

      <DateTimeDialog calendarMonth={calendarMonth} handleConfirm={handleConfirm} isDateDisabled={isDateDisabled} maxDate={maxDate} minDate={minDate} navigateMonth={navigateMonth} selectedDate={selectedDate} selectedDateTime={selectedDateTime} selectedTime={selectedTime} selectionError={selectionError} selectDate={selectDate} setCalendarOpen={setCalendarOpen} setSelectedTime={setSelectedTime} showCalendar={showCalendar} todayKey={todayKey} />
    </div>
  );
}
