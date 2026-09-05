'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchWithCsrf } from '@/lib/csrf';
import { PublicRequestShell } from '@/components/request/PublicRequestShell';
import ExternalRequestForm from './ExternalRequestForm';

export interface ExternalEvent {
  id: string;
  name: string;
  description?: string;
  endDate?: string;
}

export interface ExternalRequestFormData {
  name: string;
  email: string;
  institution: string;
  eventIds: string[];
}

function ExternalRequestPageContent() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [eventsError, setEventsError] = useState('');
  const turnstileToken = useRef('');
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [events, setEvents] = useState<ExternalEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const eventsErrorRef = useRef<HTMLDivElement>(null);
  const [formData, setFormData] = useState<ExternalRequestFormData>({
    name: '',
    email: '',
    institution: '',
    eventIds: [] as string[],
  });
  const selectedEventIds = new Set(formData.eventIds);

  useEffect(() => {
    document.title =
      'External Student Access Request | User Access Request (UAR) Portal';
  }, []);

  useEffect(() => {
    if (eventsError) {
      eventsErrorRef.current?.focus();
    }
  }, [eventsError]);

  const fetchEvents = useCallback(async () => {
    setEventsLoading(true);
    setEventsError('');
    setEvents([]);
    setFormData((current) => ({ ...current, eventIds: [] }));
    try {
      const response = await fetch('/api/events/active');
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.events)) {
        throw new Error('EVENTS_UNAVAILABLE');
      }
      setEvents(data.events);
    } catch {
      setEventsError(
        'We could not load the available events. Your request has not been submitted.',
      );
    } finally {
      setEventsLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (
      eventsLoading ||
      eventsError ||
      events.length === 0 ||
      formData.eventIds.length === 0
    ) {
      if (eventsError)
        requestAnimationFrame(() => eventsErrorRef.current?.focus());
      return;
    }
    setLoading(true);
    setSubmitError('');

    if (formData.email.endsWith('@cpp.edu')) {
      setSubmitError('Internal students should use the Internal Student form');
      setLoading(false);
      return;
    }

    try {
      const response = await fetchWithCsrf('/api/request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: formData.name,
          email: formData.email,
          institution: formData.institution,
          needsDomainAccount: true, // Always generate domain accounts
          eventId: formData.eventIds[0], // Primary event
          eventIds: formData.eventIds, // Send all selected events
          isInternal: false,
          turnstileToken: turnstileToken.current,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit request');
      }

      router.push('/request/success');
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'An error occurred. Please try again.',
      );
      setTurnstileKey((prev: number) => prev + 1);
      turnstileToken.current = '';
    } finally {
      setLoading(false);
    }
  };

  return (
    <PublicRequestShell page="requestExternal" kind="external">
          {eventsError && (
            <div
              ref={eventsErrorRef}
              role="alert"
              aria-live="assertive"
              tabIndex={-1}
              className="rounded-md border border-[var(--tone-danger-border)] bg-[var(--tone-danger-bg)] p-3 text-[var(--tone-danger-fg)] outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <p className="font-medium">Events are unavailable</p>
              <p className="mt-1 text-sm">{eventsError}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void fetchEvents()}
                  className="rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:bg-foreground/90"
                >
                  Retry
                </button>
                <a
                  href="mailto:soc@cpp.edu?subject=External%20request%20events%20unavailable"
                  className="rounded-md border border-current px-3 py-2 text-sm font-medium hover:bg-background/50"
                >
                  Contact Support
                </a>
              </div>
            </div>
          )}

          {submitError && (
            <div
              role="alert"
              className="rounded-md border border-[var(--tone-danger-border)] bg-[var(--tone-danger-bg)] p-3 text-[var(--tone-danger-fg)]"
            >
              <p>{submitError}</p>
            </div>
          )}

          <ExternalRequestForm
            onSubmit={handleSubmit}
            eventsLoading={eventsLoading}
            eventsError={eventsError}
            events={events}
            loading={loading}
            formData={formData}
            setFormData={setFormData}
            selectedEventIds={selectedEventIds}
            turnstileKey={turnstileKey}
            onTurnstileVerify={(token) => {
              turnstileToken.current = token;
            }}
          />
    </PublicRequestShell>
  );
}

export default function ExternalRequestPage() {
  return <ExternalRequestPageContent />;
}
