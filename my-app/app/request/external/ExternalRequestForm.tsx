'use client';

import type { Dispatch, FormEventHandler, SetStateAction } from 'react';
import Turnstile from 'react-turnstile';
import type { ExternalEvent, ExternalRequestFormData } from './page';
import EventSelection from './EventSelection';

type ExternalRequestFormProps = {
  onSubmit: FormEventHandler<HTMLFormElement>;
  eventsLoading: boolean;
  eventsError: string;
  events: ExternalEvent[];
  loading: boolean;
  formData: ExternalRequestFormData;
  setFormData: Dispatch<SetStateAction<ExternalRequestFormData>>;
  selectedEventIds: Set<string>;
  turnstileKey: number;
  onTurnstileVerify: (token: string) => void;
};

export default function ExternalRequestForm({
  onSubmit,
  eventsLoading,
  eventsError,
  events,
  loading,
  formData,
  setFormData,
  selectedEventIds,
  turnstileKey,
  onTurnstileVerify,
}: ExternalRequestFormProps) {
  return (
    <form
      onSubmit={onSubmit}
      className="space-y-6"
      aria-busy={eventsLoading || loading}
    >
      <fieldset
        disabled={
          eventsLoading ||
          Boolean(eventsError) ||
          events.length === 0 ||
          loading
        }
        className="contents"
      >
        <div>
          <label
            htmlFor="name"
            className="block text-sm font-medium text-foreground/90 mb-2"
          >
            Full Name <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="name"
            name="name"
            autoComplete="name"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-4 py-3 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent bg-card text-foreground"
            placeholder="Dade Murphy"
          />
        </div>

        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-foreground/90 mb-2"
          >
            Email Address <span className="text-red-500">*</span>
          </label>
          <input
            type="email"
            id="email"
            name="email"
            autoComplete="email"
            required
            value={formData.email}
            onChange={(e) =>
              setFormData({ ...formData, email: e.target.value })
            }
            className="w-full px-4 py-3 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent bg-card text-foreground"
            placeholder="dademurphy@student.edu"
          />
          <p className="mt-1 text-sm text-muted-foreground">
            Your institutional email address
          </p>
        </div>

        <div>
          <label
            htmlFor="institution"
            className="block text-sm font-medium text-foreground/90 mb-2"
          >
            Institution/Organization <span className="text-red-500">*</span>
          </label>
          <input
            type="text"
            id="institution"
            name="institution"
            autoComplete="organization"
            required
            value={formData.institution}
            onChange={(e) =>
              setFormData({ ...formData, institution: e.target.value })
            }
            className="w-full px-4 py-3 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent bg-card text-foreground"
            placeholder="Example University"
          />
        </div>

        <EventSelection
          eventsLoading={eventsLoading}
          eventsError={eventsError}
          events={events}
          formData={formData}
          setFormData={setFormData}
          selectedEventIds={selectedEventIds}
        />

        <p className="rounded-md border bg-muted/25 px-3 py-2.5 text-sm text-muted-foreground">
          External access is temporary and ends with the selected event. We will email a verification link before review begins.
        </p>

        {!eventsLoading && !eventsError && events.length > 0 && (
          <div className="flex justify-center">
            <Turnstile
              key={turnstileKey}
              sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''}
              onVerify={(token) => {
                onTurnstileVerify(token);
              }}
            />
          </div>
        )}

        <button
          type="submit"
          disabled={
            eventsLoading ||
            Boolean(eventsError) ||
            events.length === 0 ||
            loading ||
            formData.eventIds.length === 0
          }
          className="w-full py-3 px-6 bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground font-semibold rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <svg
                className="animate-spin h-5 w-5 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                ></circle>
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                ></path>
              </svg>
              Submitting...
            </>
          ) : (
            <>
              Submit Request
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M13 7l5 5m0 0l-5 5m5-5H6"
                />
              </svg>
            </>
          )}
        </button>
      </fieldset>
    </form>
  );
}
