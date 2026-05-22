'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import Turnstile from 'react-turnstile';
import { fetchWithCsrf } from '@/lib/csrf';

interface Event {
  id: string;
  name: string;
  description?: string;
  endDate?: string;
}

export default function ExternalRequestPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [events, setEvents] = useState<Event[]>([]);
  const [eventsLoading, setEventsLoading] = useState(true);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    institution: '',
    eventIds: [] as string[],
  });

  useEffect(() => {
    document.title = 'External Student Access Request | User Access Request (UAR) Portal';
  }, []);

  useEffect(() => {
    const fetchEvents = async () => {
      try {
        const response = await fetch('/api/events/active');
        const data = await response.json();
        if (response.ok) {
          setEvents(data.events);
        } else {
          setError('Failed to load events. Please try again later.');
        }
      } catch {
        setError('Failed to load events. Please try again later.');
      } finally {
        setEventsLoading(false);
      }
    };

    fetchEvents();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    if (formData.email.endsWith('@cpp.edu')) {
      setError('Internal students should use the Internal Student form');
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
          turnstileToken,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || 'Failed to submit request');
      }

      router.push('/request/success');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred. Please try again.');
      setTurnstileKey((prev: number) => prev + 1);
      setTurnstileToken('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-b from-white to-gray-100 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8"
        >
          <button
            onClick={() => router.push('/')}
            className="text-gray-700 hover:text-black hover:underline flex items-center gap-2 font-medium"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Home
          </button>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
          className="bg-white rounded-lg shadow-xl p-8 border-2 border-gray-200"
        >
          <div className="mb-8">
            <div className="flex items-center justify-center w-16 h-16 bg-black rounded-full mb-4 mx-auto">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-3xl font-bold text-gray-900 text-center mb-2">
              External Student Access Request
            </h1>
            <p className="text-gray-600 text-center">
              Request temporary VPN access for external participants
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700">{error}</p>
            </div>
          )}

          <div className="mb-4 text-sm text-gray-600">
            <p>Fields marked with an asterisk (<span className="text-red-500">*</span>) are required.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-2">
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
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent bg-white text-gray-900"
                placeholder="Dade Murphy"
              />
            </div>

            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                Email Address <span className="text-red-500">*</span>
              </label>
              <input
                type="email"
                id="email"
                name="email"
                autoComplete="email"
                required
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent bg-white text-gray-900"
                placeholder="dademurphy@student.edu"
              />
              <p className="mt-1 text-sm text-gray-600">
                Your institutional email address
              </p>
            </div>

            <div>
              <label htmlFor="institution" className="block text-sm font-medium text-gray-700 mb-2">
                Institution/Organization <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                id="institution"
                name="institution"
                autoComplete="organization"
                required
                value={formData.institution}
                onChange={(e) => setFormData({ ...formData, institution: e.target.value })}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-black focus:border-transparent bg-white text-gray-900"
                placeholder="Example University"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-3">
                Event/Reason for Access <span className="text-red-500">*</span>
              </label>
              {eventsLoading ? (
                <div className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-gray-50 text-gray-500">
                  Loading events...
                </div>
              ) : events.length === 0 ? (
                <div className="w-full px-4 py-3 border border-gray-300 rounded-lg bg-yellow-50 text-yellow-700">
                  No events available at this time. Please contact support.
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-gray-600">Select all events you need access for:</p>
                  {events.map((event) => (
                    <div
                      key={event.id}
                      onClick={() => {
                        const isSelected = formData.eventIds.includes(event.id);
                        setFormData({
                          ...formData,
                          eventIds: isSelected
                            ? formData.eventIds.filter(id => id !== event.id)
                            : [...formData.eventIds, event.id]
                        });
                      }}
                      className={`relative cursor-pointer rounded-lg border-2 p-4 transition-all ${formData.eventIds.includes(event.id)
                        ? 'border-black bg-gray-50'
                        : 'border-gray-300 bg-white hover:border-gray-400'
                        }`}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex items-center h-5">
                          <input
                            type="checkbox"
                            checked={formData.eventIds.includes(event.id)}
                            onChange={() => { }}
                            aria-labelledby={`event-name-${event.id} ${event.description ? `event-desc-${event.id}` : ''} ${event.endDate ? `event-date-${event.id}` : ''}`.trim().replace(/\s+/g, ' ')}
                            className="w-5 h-5 text-black border-gray-300 rounded focus:ring-black cursor-pointer"
                          />
                        </div>
                        <div className="flex-1">
                          <h3 id={`event-name-${event.id}`} className="font-semibold text-gray-900">{event.name}</h3>
                          {event.description && (
                            <p id={`event-desc-${event.id}`} className="mt-1 text-sm text-gray-600">{event.description}</p>
                          )}
                          {event.endDate && (
                            <p id={`event-date-${event.id}`} className="mt-1 text-sm text-gray-600">
                              Expires: {new Date(event.endDate).toLocaleDateString('en-US', {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric'
                              })}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                  {formData.eventIds.length === 0 && (
                    <p className="text-sm text-red-600 mt-2">Please select at least one event</p>
                  )}
                </div>
              )}
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-yellow-600 mt-0.5 mr-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                </svg>
                <div className="text-sm text-yellow-700">
                  <p className="font-medium mb-1">Important:</p>
                  <p>External accounts are temporary and will be tied to the specific event or time period you mentioned. Your access will expire when the event concludes.</p>
                </div>
              </div>
            </div>

            <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
              <div className="flex items-start">
                <svg className="w-5 h-5 text-yellow-600 mt-0.5 mr-3 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                </svg>
                <div className="text-sm text-yellow-700">
                  <p className="font-medium mb-1">Next Steps:</p>
                  <ul className="list-disc list-inside space-y-1">
                    <li>You&apos;ll receive a verification email</li>
                    <li>Click the link to verify your request</li>
                    <li>Our team will review and approve your request</li>
                    <li>You&apos;ll receive VPN setup instructions via email</li>
                  </ul>
                </div>
              </div>
            </div>

            <div className="flex justify-center">
              <Turnstile
                key={turnstileKey}
                sitekey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || ''}
                onVerify={(token) => setTurnstileToken(token)}
              />
            </div>

            <button
              type="submit"
              disabled={loading || formData.eventIds.length === 0}
              className="w-full py-3 px-6 bg-black hover:bg-gray-800 disabled:bg-gray-400 text-white font-semibold rounded-lg transition-colors duration-200 flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Submitting...
                </>
              ) : (
                <>
                  Submit Request
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                  </svg>
                </>
              )}
            </button>
          </form>
        </motion.div>

        <div className="mt-6 text-center text-sm text-gray-600">
          <p>
            Need help? Contact IT Support at{' '}
            <a href="mailto:soc@cpp.edu" className="text-black hover:underline">
              soc@cpp.edu
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
