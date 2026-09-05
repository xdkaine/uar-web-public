'use client';
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { ExternalEvent, ExternalRequestFormData } from './page';
type Props = {
  eventsLoading: boolean;
  eventsError: string;
  events: ExternalEvent[];
  formData: ExternalRequestFormData;
  setFormData: Dispatch<SetStateAction<ExternalRequestFormData>>;
  selectedEventIds: Set<string>;
};
function LocalizedDate({ value }: { value: string }) {
  const [formatted, setFormatted] = useState('');
  useEffect(() => {
    const frame = window.requestAnimationFrame(() =>
      setFormatted(
        new Date(value).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
      ),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [value]);
  return <>{formatted}</>;
}
export default function EventSelection({
  eventsLoading,
  eventsError,
  events,
  formData,
  setFormData,
  selectedEventIds,
}: Props) {
  return (
    <>
      <div>
        <p className="block text-sm font-medium text-foreground/90 mb-3">
          Event/Reason for Access <span className="text-red-500">*</span>
        </p>
        {eventsError ? null : eventsLoading ? (
          <div className="w-full px-4 py-3 border border-input rounded-lg bg-muted/50 text-muted-foreground">
            Loading events...
          </div>
        ) : events.length === 0 ? (
          <div className="w-full px-4 py-3 border border-input rounded-lg bg-yellow-50 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-200 dark:border-yellow-900">
            No events available at this time. Please contact support.
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Select all events you need access for:
            </p>
            {events.map((event) => (
              <label
                key={event.id}
                htmlFor={`event-${event.id}`}
                className={`relative block cursor-pointer rounded-lg border-2 p-4 transition-colors ${
                  selectedEventIds.has(event.id)
                    ? 'border-primary bg-muted/50'
                    : 'border-input bg-card hover:border-ring'
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex items-center h-5">
                    <input
                      type="checkbox"
                      id={`event-${event.id}`}
                      checked={selectedEventIds.has(event.id)}
                      onChange={() =>
                        setFormData((current) => ({
                          ...current,
                          eventIds: selectedEventIds.has(event.id)
                            ? current.eventIds.filter((id) => id !== event.id)
                            : [...current.eventIds, event.id],
                        }))
                      }
                      aria-labelledby={`event-name-${event.id} ${event.description ? `event-desc-${event.id}` : ''} ${event.endDate ? `event-date-${event.id}` : ''}`
                        .trim()
                        .replace(/\s+/g, ' ')}
                      className="w-5 h-5 accent-primary border-input rounded focus:ring-ring cursor-pointer"
                    />
                  </div>
                  <div className="flex-1">
                    <h3
                      id={`event-name-${event.id}`}
                      className="font-semibold text-foreground"
                    >
                      {event.name}
                    </h3>
                    {event.description && (
                      <p
                        id={`event-desc-${event.id}`}
                        className="mt-1 text-sm text-muted-foreground"
                      >
                        {event.description}
                      </p>
                    )}
                    {event.endDate && (
                      <p
                        id={`event-date-${event.id}`}
                        className="mt-1 text-sm text-muted-foreground"
                      >
                        Expires: <LocalizedDate value={event.endDate} />
                      </p>
                    )}
                  </div>
                </div>
              </label>
            ))}
            {formData.eventIds.length === 0 && (
              <p className="text-sm text-red-600 dark:text-red-400 mt-2">
                Please select at least one event
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
