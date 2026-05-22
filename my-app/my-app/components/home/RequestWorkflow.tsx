'use client';

import { motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

type CursorPosition = {
  x: string;
  y: string;
};

type FormState = {
  role: 'internal' | 'external';
  name: string;
  email: string;
  institution: string;
  event: string;
};

type FormField = keyof FormState;

type HighlightField = FormField | 'submit';

type InteractiveStep = {
  id: string;
  position: CursorPosition;
  duration: number;
  highlight?: HighlightField | null;
  updates?: Partial<FormState>;
  target?: FormField;
  typingValue?: string;
  typingSpeed?: number;
  click?: boolean;
};

const INTERACTIVE_STEPS: InteractiveStep[] = [
  {
    id: 'reset',
    position: { x: '74%', y: '22%' },
    duration: 800,
    highlight: null,
    updates: { role: 'internal', name: '', email: '', institution: '', event: '' },
  },
  {
    id: 'role',
    position: { x: '32%', y: '36%' },
    duration: 1200,
    highlight: 'role',
    updates: { role: 'internal' },
    click: true,
  },
  {
    id: 'name',
    position: { x: '36%', y: '56%' },
    duration: 1600,
    highlight: 'name',
    target: 'name',
    typingValue: 'Billy Bronco',
    typingSpeed: 55,
  },
  {
    id: 'email',
    position: { x: '36%', y: '72%' },
    duration: 1800,
    highlight: 'email',
    target: 'email',
    typingValue: 'bbronco@cpp.edu',
    typingSpeed: 55,
  },
  {
    id: 'submit',
    position: { x: '72%', y: '88%' },
    duration: 1500,
    highlight: 'submit',
    click: true,
  },
];

const META_LABEL_CLASS = 'text-[11px] font-semibold uppercase tracking-[0.2em]';
const MICRO_LABEL_CLASS = 'text-[10px] font-medium uppercase tracking-[0.25em]';
const BODY_TEXT_CLASS = 'text-sm text-gray-700 leading-relaxed';
const CARD_BASE_CLASS = 'rounded-xl border border-gray-200 bg-white shadow-sm';

const AnimatedCursor = ({ position, isClicking }: { position: CursorPosition; isClicking: boolean }) => (
  <motion.div
    className="pointer-events-none absolute z-40"
    animate={{ left: position.x, top: position.y, scale: isClicking ? 0.92 : 1 }}
    transition={{ type: 'spring', stiffness: 220, damping: 30 }}
  >
    <motion.svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      initial={false}
      animate={{ scale: isClicking ? 0.9 : 1, rotate: isClicking ? -4 : 0 }}
      transition={{ type: 'spring', stiffness: 200, damping: 24 }}
      className="drop-shadow-[0_4px_6px_rgba(15,23,42,0.25)]"
    >
      <path
        d="M4 3.5L9.5 20.5L11.75 14.5L17.5 17.75L4 3.5Z"
        fill={isClicking ? '#0f172a' : '#111827'}
      />
      <path
        d="M4 3.5L9.5 20.5L11.75 14.5L17.5 17.75L4 3.5Z"
        stroke="#f8fafc"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </motion.svg>
  </motion.div>
);

const InteractiveRequestDemo = ({ isPaused }: { isPaused: boolean }) => {
  const [stepIndex, setStepIndex] = useState(0);
  const [formState, setFormState] = useState<FormState>({
    role: 'internal',
    name: '',
    email: '',
    institution: '',
    event: '',
  });
  const [submitPulse, setSubmitPulse] = useState(false);

  useEffect(() => {
    if (isPaused) return;
    const step = INTERACTIVE_STEPS[stepIndex];
    let typingInterval: ReturnType<typeof setInterval> | null = null;
    let pulseTimeout: ReturnType<typeof setTimeout> | null = null;
    let syncTimeout: ReturnType<typeof setTimeout> | null = null;

    syncTimeout = setTimeout(() => {
      if (step.updates) {
        setFormState(prev => ({ ...prev, ...step.updates }));
      }

      if (step.typingValue && step.target) {
        let index = 0;
        typingInterval = setInterval(() => {
          index += 1;
          const slice = step.typingValue!.slice(0, index);
          setFormState(prev => ({ ...prev, [step.target as FormField]: slice }));
          if (index >= step.typingValue!.length) {
            clearInterval(typingInterval!);
            typingInterval = null;
          }
        }, step.typingSpeed ?? 60);
      }

      if (step.id === 'submit') {
        setSubmitPulse(true);
        pulseTimeout = setTimeout(() => {
          setSubmitPulse(false);
        }, 900);
      } else {
        setSubmitPulse(false);
      }
    }, 0);

    const timer = setTimeout(() => {
      setStepIndex(prev => (prev + 1) % INTERACTIVE_STEPS.length);
    }, step.duration);

    return () => {
      clearTimeout(timer);
      if (typingInterval) {
        clearInterval(typingInterval);
      }
      if (pulseTimeout) {
        clearTimeout(pulseTimeout);
      }
      if (syncTimeout) {
        clearTimeout(syncTimeout);
      }
    };
  }, [stepIndex, isPaused]);

  const currentStep = INTERACTIVE_STEPS[stepIndex] ?? INTERACTIVE_STEPS[0];
  const currentPosition = currentStep.position;
  const activeField = currentStep.highlight ?? null;
  const isClicking = Boolean(currentStep.click);

  const highlightClasses = (field: HighlightField) => {
    if (field === 'submit') {
      return activeField === 'submit'
        ? 'border-gray-900 shadow-[0_0_0_2px_rgba(17,24,39,0.2)] ring-1 ring-gray-900/20'
        : 'border-transparent';
    }

    if (field === 'role') {
      return activeField === 'role'
        ? 'ring-2 ring-gray-900/20 shadow-[0_8px_18px_rgba(15,23,42,0.12)]'
        : '';
    }

    const isActive = field === activeField;
    return isActive
      ? 'border-gray-900 shadow-[0_0_0_2px_rgba(17,24,39,0.12)] bg-white'
      : 'border-gray-200';
  };

  return (
    <div className="relative space-y-3">
      <AnimatedCursor position={currentPosition} isClicking={isClicking} />
      <div className="mx-auto w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3">
          <div>
            <p className={`${MICRO_LABEL_CLASS} text-gray-700`}>Request form</p>
            <p className="mt-1 text-base font-semibold text-gray-900">Choose your path</p>
          </div>
          <motion.span
            className="rounded-full bg-gray-900 px-3 py-1 text-xs font-medium text-white"
            animate={{ opacity: submitPulse ? 0.6 : 1 }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
          >
            Step 1
          </motion.span>
        </div>
        <div className="space-y-3 px-4 py-3">
          <div className={`flex flex-wrap items-center gap-2 rounded-xl bg-gray-50 px-3 py-2 ${highlightClasses('role')}`}>
            <motion.button
              type="button"
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] ${formState.role === 'internal'
                ? 'border-gray-900 bg-gray-900 text-white'
                : 'border-gray-200 bg-white text-gray-700'
                }`}
              animate={{ scale: activeField === 'role' ? 1.02 : 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18 }}
              disabled
            >
              Internal student
            </motion.button>
            <motion.button
              type="button"
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-gray-600"
              disabled
            >
              External visitor
            </motion.button>
            <p className={`ml-auto ${META_LABEL_CLASS} text-gray-700`}>Pick your route</p>
          </div>
          <div className="grid gap-3">
            <label className={`block ${META_LABEL_CLASS} text-gray-700`}>
              Full name
              <motion.input
                className={`mt-1.5 w-full rounded-lg border bg-gray-50 px-3 py-2 text-sm text-gray-700 shadow-inner placeholder-gray-400 focus:outline-none ${highlightClasses('name')}`}
                placeholder="Billy Bronco"
                value={formState.name}
                disabled
                animate={{ backgroundColor: activeField === 'name' ? '#fff' : '#f9fafb' }}
                transition={{ duration: 0.4 }}
              />
            </label>
            <label className={`block ${META_LABEL_CLASS} text-gray-700`}>
              Cal Poly email
              <motion.input
                className={`mt-1.5 w-full rounded-lg border bg-gray-50 px-3 py-2 text-sm text-gray-700 shadow-inner placeholder-gray-400 focus:outline-none ${highlightClasses('email')}`}
                placeholder="bbronco@cpp.edu"
                value={formState.email}
                disabled
                animate={{ backgroundColor: activeField === 'email' ? '#fff' : '#f9fafb' }}
                transition={{ duration: 0.4 }}
              />
            </label>
          </div>
          <p className={`rounded-lg bg-gray-50 px-3 py-2 ${BODY_TEXT_CLASS}`}>
            External visitors provide an institution name and event selection — those fields appear once “External visitor” is chosen.
          </p>
          <div className="flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
            <p className={BODY_TEXT_CLASS}>
              Next: Check the verification email we send immediately.
            </p>
            <motion.button
              type="button"
              className={`rounded-lg border px-3 py-1.5 text-xs font-semibold text-white opacity-80 ${highlightClasses('submit')} bg-gray-900`}
              disabled
              animate={{ scale: submitPulse ? 1.06 : 1 }}
              transition={{ type: 'spring', stiffness: 260, damping: 16 }}
            >
              Submit request
            </motion.button>
          </div>
        </div>
      </div>
    </div>
  );
};

type VerificationHighlight = 'callout' | 'emailHeader' | 'emailBody' | 'emailButton' | 'emailMeta';

type VerificationStep = {
  position: CursorPosition;
  duration: number;
  highlight: VerificationHighlight;
  click?: boolean;
};

const VERIFICATION_STEPS: VerificationStep[] = [
  { position: { x: '18%', y: '13%' }, duration: 1400, highlight: 'callout', click: true },
  { position: { x: '53%', y: '33%' }, duration: 1400, highlight: 'emailHeader', click: true },
  { position: { x: '56%', y: '53%' }, duration: 1600, highlight: 'emailBody' },
  { position: { x: '80%', y: '68%' }, duration: 1400, highlight: 'emailButton', click: true },
  { position: { x: '65%', y: '82%' }, duration: 1200, highlight: 'emailMeta' },
];

const InteractiveVerificationDemo = ({ isPaused }: { isPaused: boolean }) => {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (isPaused) return;
    const step = VERIFICATION_STEPS[stepIndex];

    const timer = setTimeout(() => {
      setStepIndex(prev => (prev + 1) % VERIFICATION_STEPS.length);
    }, step.duration);

    return () => {
      clearTimeout(timer);
    };
  }, [stepIndex, isPaused]);

  const currentStep = VERIFICATION_STEPS[stepIndex] ?? VERIFICATION_STEPS[0];
  const currentPosition = currentStep.position;
  const activeHighlight = currentStep.highlight;
  const isClicking = Boolean(currentStep.click);

  const highlightClasses = (key: VerificationHighlight) =>
    key === activeHighlight ? 'ring-2 ring-blue-500/30 shadow-[0_10px_25px_rgba(37,99,235,0.12)] bg-white' : '';

  return (
    <div className="relative space-y-4">
      <AnimatedCursor position={currentPosition} isClicking={isClicking} />
      <motion.div
        className={`flex items-center gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-blue-800 ${highlightClasses('callout')}`}
        animate={{ opacity: activeHighlight === 'callout' ? 1 : 0.9 }}
        transition={{ duration: 0.3 }}
      >
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-semibold text-white">1</span>
        <div>
          <p className={`${META_LABEL_CLASS} text-blue-600`}>Check your inbox</p>
          <p className="text-sm font-medium text-blue-900">Pause here until the link is confirmed.</p>
        </div>
      </motion.div>
      <div className={CARD_BASE_CLASS}>
        <div className={`border-b border-gray-200 bg-gray-50 px-4 py-3 ${highlightClasses('emailHeader')}`}>
          <p className={`${META_LABEL_CLASS} text-gray-700`}>Inbox preview</p>
          <p className="text-sm font-semibold text-gray-900">Verify your UAR request</p>
        </div>
        <div className="space-y-3 px-4 py-4">
          <motion.p
            className={`rounded-lg px-3 py-2 ${BODY_TEXT_CLASS} ${highlightClasses('emailBody')}`}
            animate={{ opacity: activeHighlight === 'emailBody' ? 1 : 0.95 }}
            transition={{ duration: 0.3 }}
          >
            Hi Alex, thanks for reaching out for SDC access. Tap the secure button below so we know this was you.
          </motion.p>
          <motion.button
            type="button"
            className={`w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white opacity-90 shadow-sm ${highlightClasses('emailButton')}`}
            disabled
            animate={{ scale: activeHighlight === 'emailButton' ? 1.04 : 1 }}
            transition={{ type: 'spring', stiffness: 240, damping: 18 }}
          >
            Verify my email
          </motion.button>
          <div
            className={`flex flex-wrap items-center justify-between gap-2 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-700 ${highlightClasses('emailMeta')}`}
          >
            <p>Link expires in 24 hours</p>
            <p>Need help? Reply to this email.</p>
          </div>
        </div>
      </div>
    </div>
  );
};

type DirectorHighlight = 'badge' | 'checklist' | 'routing' | 'actions';

type DirectorStep = {
  position: CursorPosition;
  duration: number;
  highlight: DirectorHighlight;
  click?: boolean;
};

const DIRECTOR_STEPS: DirectorStep[] = [
  { position: { x: '28%', y: '14%' }, duration: 1400, highlight: 'badge' },
  { position: { x: '33%', y: '48%' }, duration: 1600, highlight: 'checklist', click: true },
  { position: { x: '72%', y: '50%' }, duration: 1600, highlight: 'routing' },
  { position: { x: '80%', y: '78%' }, duration: 1500, highlight: 'actions', click: true },
];

const InteractiveDirectorReviewDemo = ({ isPaused }: { isPaused: boolean }) => {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (isPaused) return;
    const step = DIRECTOR_STEPS[stepIndex];

    const timer = setTimeout(() => {
      setStepIndex(prev => (prev + 1) % DIRECTOR_STEPS.length);
    }, step.duration);

    return () => {
      clearTimeout(timer);
    };
  }, [stepIndex, isPaused]);

  const currentStep = DIRECTOR_STEPS[stepIndex] ?? DIRECTOR_STEPS[0];
  const currentPosition = currentStep.position;
  const activeHighlight = currentStep.highlight;
  const isClicking = Boolean(currentStep.click);

  const highlightClasses = (key: DirectorHighlight) =>
    key === activeHighlight ? 'ring-2 ring-emerald-500/25 shadow-[0_10px_25px_rgba(16,185,129,0.16)]' : '';

  return (
    <div className="relative space-y-4">
      <AnimatedCursor position={currentPosition} isClicking={isClicking} />
      <div className={`flex items-center gap-3 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-emerald-800 ${highlightClasses('badge')}`}>
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-emerald-600 text-white shadow-md">
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 12.75l2.25 2.25L15 11.25" />
            <path d="M9 6.75h6" />
            <path d="M16.5 6.75V6a2.25 2.25 0 00-2.25-2.25h-4.5A2.25 2.25 0 007.5 6v.75H6.75A2.25 2.25 0 004.5 9v9A2.25 2.25 0 006.75 20.25h10.5A2.25 2.25 0 0019.5 18v-9a2.25 2.25 0 00-2.25-2.25H16.5z" />
          </svg>
        </span>
        <div>
          <p className={`${META_LABEL_CLASS} text-emerald-700`}>Student directors</p>
          <p className="text-sm font-medium text-emerald-900">Preparing credentials and timelines.</p>
        </div>
      </div>
      <div className={CARD_BASE_CLASS}>
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3">
          <div>
            <p className={`${META_LABEL_CLASS} text-gray-700`}>Request #2317</p>
            <p className="text-sm font-semibold text-gray-900">SDC Analytics Spring Workshop</p>
          </div>
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800">Pending Student Directors</span>
        </div>
        <div className="grid gap-3 px-4 py-4 sm:grid-cols-2">
          <div className={`rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-3 text-sm text-emerald-900 ${highlightClasses('checklist')}`}>
            <p className={`${META_LABEL_CLASS} text-emerald-700`}>Checklist</p>
            <ul className="mt-2 space-y-1">
              <li>✔️ AD username reserved</li>
              <li>✔️ Disable date captured</li>
              <li>⏳ VPN Account Drafting</li>
            </ul>
          </div>
          <div className={`rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-sm text-gray-700 ${highlightClasses('routing')}`}>
            <p className={`${META_LABEL_CLASS} text-gray-700`}>Routing</p>
            <ul className="mt-2 space-y-1">
              <li>Student Directors • Active</li>
              <li>Faculty Approvers • Next</li>
              <li>Audit Log • Recording updates</li>
            </ul>
          </div>
        </div>
        <div className={`flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 ${highlightClasses('actions')}`}>
          <button
            type="button"
            className="rounded-lg border border-emerald-200 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-800"
            disabled
          >
            Request clarification
          </button>
          <button
            type="button"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white opacity-90"
            disabled
          >
            Send to faculty
          </button>
        </div>
      </div>
    </div>
  );
};

type FacultyHighlight = 'callout' | 'packet' | 'notes' | 'actions';

type FacultyStep = {
  position: CursorPosition;
  duration: number;
  highlight: FacultyHighlight;
  click?: boolean;
};

const FACULTY_STEPS: FacultyStep[] = [
  { position: { x: '28%', y: '14%' }, duration: 1400, highlight: 'callout' },
  { position: { x: '42%', y: '48%' }, duration: 1700, highlight: 'packet', click: true },
  { position: { x: '70%', y: '60%' }, duration: 1700, highlight: 'notes' },
  { position: { x: '75%', y: '82%' }, duration: 1500, highlight: 'actions', click: true },
];

const InteractiveFacultyReviewDemo = ({ isPaused }: { isPaused: boolean }) => {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (isPaused) return;
    const step = FACULTY_STEPS[stepIndex];

    const timer = setTimeout(() => {
      setStepIndex(prev => (prev + 1) % FACULTY_STEPS.length);
    }, step.duration);

    return () => {
      clearTimeout(timer);
    };
  }, [stepIndex, isPaused]);

  const currentStep = FACULTY_STEPS[stepIndex] ?? FACULTY_STEPS[0];
  const currentPosition = currentStep.position;
  const activeHighlight = currentStep.highlight;
  const isClicking = Boolean(currentStep.click);

  const highlightClasses = (key: FacultyHighlight) =>
    key === activeHighlight ? 'ring-2 ring-amber-500/25 shadow-[0_10px_25px_rgba(245,158,11,0.16)]' : '';

  return (
    <div className="relative space-y-4">
      <AnimatedCursor position={currentPosition} isClicking={isClicking} />
      <div className={`flex items-center gap-3 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-amber-800 ${highlightClasses('callout')}`}>
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-amber-600 text-white shadow-md">
          <svg
            className="h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 12l2 2 4-4" />
            <path d="M12 2.25l8.25 4.5v5.25c0 5.52-3.72 10.53-8.25 12-4.53-1.47-8.25-6.48-8.25-12V6.75l8.25-4.5z" />
          </svg>
        </span>
        <div>
          <p className={`${META_LABEL_CLASS} text-amber-700`}>Pending faculty</p>
          <p className="text-sm font-medium text-amber-900">Creating VPN accounts and confirming approvals.</p>
        </div>
      </div>
      <div className={CARD_BASE_CLASS}>
        <div className="flex items-center justify-between border-b border-gray-200 bg-gray-50 px-4 py-3">
          <div>
            <p className={`${META_LABEL_CLASS} text-gray-700`}>Faculty queue</p>
            <p className="text-sm font-semibold text-gray-900">VPN Account Creation Packet</p>
          </div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">Pending Faculty</span>
        </div>
        <div className="space-y-3 px-4 py-4">
          <div className={`rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-900 ${highlightClasses('packet')}`}>
            <p className={`${META_LABEL_CLASS} text-amber-700`}>What faculty sees</p>
            <ul className="mt-2 space-y-1">
              <li>AD Username: ajarvis</li>
              <li>VPN Username: ajarvis</li>
              <li>Disable Date: May 30, 2025 • 23:59</li>
            </ul>
          </div>
          <div className={`rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700 space-y-2 ${highlightClasses('notes')}`}>
            <p className={`${META_LABEL_CLASS} text-gray-700`}>Director notes</p>
            <p>Workshop runs May 10–12. VPN access required for remote labs. Credentials staged through Active Directory.</p>
            <p>Status updates sync back to the portal immediately.</p>
          </div>
        </div>
        <div className={`flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 ${highlightClasses('actions')}`}>
          <button
            type="button"
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white opacity-90"
            disabled
          >
            Confirm VPN created
          </button>
          <button
            type="button"
            className="rounded-lg border border-amber-200 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.2em] text-amber-800"
            disabled
          >
            Return to directors
          </button>
        </div>
      </div>
    </div>
  );
};

type ApprovalHighlight = 'card' | 'package' | 'instructions' | 'button';

type ApprovalStep = {
  position: CursorPosition;
  duration: number;
  highlight: ApprovalHighlight;
  click?: boolean;
};

const APPROVAL_STEPS: ApprovalStep[] = [
  { position: { x: '30%', y: '14%' }, duration: 1400, highlight: 'card' },
  { position: { x: '45%', y: '44%' }, duration: 1700, highlight: 'package', click: true },
  { position: { x: '70%', y: '62%' }, duration: 1700, highlight: 'instructions' },
  { position: { x: '74%', y: '82%' }, duration: 1500, highlight: 'button', click: true },
];

const InteractiveApprovalDemo = ({ isPaused }: { isPaused: boolean }) => {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (isPaused) return;
    const step = APPROVAL_STEPS[stepIndex];

    const timer = setTimeout(() => {
      setStepIndex(prev => (prev + 1) % APPROVAL_STEPS.length);
    }, step.duration);

    return () => {
      clearTimeout(timer);
    };
  }, [stepIndex, isPaused]);

  const currentStep = APPROVAL_STEPS[stepIndex] ?? APPROVAL_STEPS[0];
  const currentPosition = currentStep.position;
  const activeHighlight = currentStep.highlight;
  const isClicking = Boolean(currentStep.click);

  const highlightClasses = (key: ApprovalHighlight) =>
    key === activeHighlight ? 'ring-2 ring-indigo-500/25 shadow-[0_10px_25px_rgba(79,70,229,0.16)]' : '';

  return (
    <div className="relative space-y-4">
      <AnimatedCursor position={currentPosition} isClicking={isClicking} />
      <div className={`flex items-center gap-3 rounded-xl border border-indigo-100 bg-indigo-50 px-4 py-3 text-indigo-800 ${highlightClasses('card')}`}>
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-white shadow-md">
          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 5.25h18" />
            <path d="M5.25 9h13.5" />
            <path d="M7.5 12.75h9" />
            <path d="M9.75 16.5h4.5" />
          </svg>
        </span>
        <div>
          <p className={`${META_LABEL_CLASS} text-indigo-600`}>All set</p>
          <p className="text-sm font-medium text-indigo-900">Credentials and instructions are ready.</p>
        </div>
      </div>
      <div className={CARD_BASE_CLASS}>
        <div className="border-b border-gray-200 bg-gray-50 px-4 py-3">
          <p className={`${META_LABEL_CLASS} text-gray-700`}>Welcome email</p>
          <p className="text-sm font-semibold text-gray-900">Access approved for SDC resources</p>
        </div>
        <div className="space-y-3 px-4 py-4">
          <div className={`rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 ${highlightClasses('package')}`}>
            <p className={`${META_LABEL_CLASS} text-indigo-600`}>Credential package</p>
            <ul className="mt-2 space-y-2 text-sm text-indigo-900">
              <li>
                <span className="text-gray-500">Username</span>: <span className="font-semibold">ajarvis</span>
              </li>
              <li>
                <span className="text-gray-500">Temp password</span>: Delivered securely
              </li>
              <li>
                <span className="text-gray-500">Systems</span>: Kamino • Proxmox
              </li>
            </ul>
          </div>
          <div className={`rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-700 space-y-2 ${highlightClasses('instructions')}`}>
            <p className={`${META_LABEL_CLASS} text-gray-700`}>First login steps</p>
            <p>1. Update your password within 24 hours of first login.</p>
            <p>2. Review VPN setup instructions before connecting remotely.</p>
            <p>3. Need help? Open a support ticket directly from the portal.</p>
          </div>
          <motion.button
            type="button"
            className={`w-full rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white opacity-90 shadow-sm ${highlightClasses('button')}`}
            disabled
            animate={{ scale: activeHighlight === 'button' ? 1.04 : 1 }}
            transition={{ type: 'spring', stiffness: 240, damping: 18 }}
          >
            Open instructions
          </motion.button>
        </div>
      </div>
    </div>
  );
};

type WorkflowStep = {
  title: string;
  description: string;
  caption: string;
  color: string;
  window: {
    title: string;
    subtitle: string;
    summary: string;
    highlights: string[];
    userSteps: string[];
    teamSteps: string[];
    content: (isPaused: boolean) => ReactNode;
  };
};

const workflowSteps: WorkflowStep[] = [
  {
    title: 'Share Your Request',
    description:
      'Pick the internal or external path, share the required details, and submit. The form takes only a couple of minutes and works great on mobile.',
    caption: 'As soon as you submit, we email a confirmation with the next steps.',
    color: 'bg-black',
    window: {
      title: 'Tell us what you need',
      subtitle: 'Step 1 • Online form',
      summary:
        'Choose the Internal Student or External Visitor form. Internal students provide a name and @cpp.edu email, while external visitors also list their institution and select the event they are attending. Submit the request and you will receive a confirmation email immediately.',
      highlights: ['Works on desktop or mobile', 'Takes about 2 minutes'],
      userSteps: [
        'Choose the Internal Student or External Visitor option.',
        'Enter the required contact details (institution + event for visitors).',
        'Press submit to lock in your request.',
      ],
      teamSteps: [
        'Create your request record instantly.',
        'Send you a confirmation email with a secure verification link.',
        'Hold the request until you verify your email.',
      ],
      content: (paused: boolean) => <InteractiveRequestDemo isPaused={paused} />,
    },
  },
  {
    title: 'Verify Your Email',
    description:
      'Click the link in the message we send right after submission. Verification lets us know it was really you who made the request.',
    caption: 'We pause everything until you confirm, so nothing moves forward without you.',
    color: 'bg-blue-600',
    window: {
      title: 'Confirm your email',
      subtitle: 'Step 2 • Email link',
      summary:
        'Tap the secure button in the email. It confirms your address and lets us move your request to the review queue.',
      highlights: ['Secure link expires in 24 hours', 'Only takes one tap'],
      userSteps: [
        'Open the email titled "Verify your UAR request".',
        'Click the secure verification button.',
        'Sign in if asked so we can connect the request to your account.',
      ],
      teamSteps: [
        'Mark your request as verified and ready for review.',
        'Alert the Student Director team that a new request is waiting.',
        'Log the verification time for your records.',
      ],
      content: (paused: boolean) => <InteractiveVerificationDemo isPaused={paused} />,
    },
  },
  {
    title: 'Student Director Review',
    description:
      'Directors double-check the request, prep any accounts, and reach out if they need more details.',
    caption: 'You stay updated by email if we have questions or need clarification.',
    color: 'bg-emerald-600',
    window: {
      title: 'Directors prepare your access',
      subtitle: 'Step 3 • Review queue',
      summary:
        'Student Directors validate your request, stage credentials, and decide whether the account can be created immediately or needs faculty activation.',
      highlights: ['Directors respond within one business day', 'Credentials staged before faculty activation'],
      userSteps: [
        'Watch for an email if we need more details.',
        'Reply quickly so we can keep the request moving.',
        'Track progress anytime from the status page.',
      ],
      teamSteps: [
        'Confirm the request matches SOC and SDC guidelines.',
        'Generate usernames, passwords, and disable dates when required.',
        'Move the request to faculty approval when everything is staged.',
      ],
      content: (paused: boolean) => <InteractiveDirectorReviewDemo isPaused={paused} />,
    },
  },
  {
    title: 'Faculty Activation',
    description:
      'Faculty confirm compliance, create VPN accounts when needed, and sign off before we deliver credentials.',
    caption: 'Student Directors coordinate closely and keep you informed of the final approval timing.',
    color: 'bg-amber-600',
    window: {
      title: 'Faculty finalize access',
      subtitle: 'Step 4 • Faculty review',
      summary:
        'Faculty reviewers receive the staged credentials packet from Student Directors, create VPN access when required, and record the official approval.',
      highlights: ['VPN accounts issued by faculty', 'Direct coordination with campus policy'],
      userSteps: [
        'Watch for any follow-up questions from the faculty approver.',
        'If contacted, confirm event timelines or attendee details promptly.',
        'Keep an eye on your email for the approval notice once they finish.',
      ],
      teamSteps: [
        'Faculty create VPN or special accounts the request needs.',
        'Student Directors confirm the credentials match what was staged.',
        'System records the approval timestamp and moves the request to final delivery.',
      ],
      content: (paused: boolean) => <InteractiveFacultyReviewDemo isPaused={paused} />,
    },
  },
  {
    title: 'Approval & Credentials Sent',
    description:
      'After faculty activates your request, we send your credentials and quick start instructions.',
    caption: 'You are ready to log in right away and support is available if you need help.',
    color: 'bg-indigo-600',
    window: {
      title: 'You are approved',
      subtitle: 'Step 5 • Welcome email',
      summary:
        'As soon as faculty sign-off is recorded, our system delivers your credentials, setup tips, and links to support so you can get started immediately.',
      highlights: ['Includes credential bundle', 'Support link stays handy'],
      userSteps: [
        'Open the "You are approved" email and follow the setup steps.',
        'Store your credentials somewhere secure.',
        'Reach out through support if anything looks off.',
      ],
      teamSteps: [
        'Confirm faculty completion and finalize auditing.',
        'Send your credential bundle and instructions.',
        'Stay available for questions after delivery.',
      ],
      content: (paused: boolean) => <InteractiveApprovalDemo isPaused={paused} />,
    },
  },
];

const STEP_INTERVAL_MS = 10000;

export function RequestWorkflow() {
  const [activeStep, setActiveStep] = useState(0);
  const [progressCycle, setProgressCycle] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const totalSteps = workflowSteps.length;
  const cycleRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const scheduleCycle = useCallback(() => {
    if (cycleRef.current) {
      clearInterval(cycleRef.current);
      cycleRef.current = null;
    }

    if (totalSteps === 0 || isPaused) {
      return;
    }

    cycleRef.current = setInterval(() => {
      setActiveStep(prev => (prev + 1) % totalSteps);
      setProgressCycle(prev => prev + 1);
    }, STEP_INTERVAL_MS);
    setProgressCycle(prev => prev + 1);
  }, [isPaused, totalSteps]);

  const handleStepChange = useCallback(
    (index: number) => {
      setActiveStep(index);
      scheduleCycle();
    },
    [scheduleCycle]
  );

  useEffect(() => {
    const asyncId = setTimeout(() => {
      scheduleCycle();
    }, 0);

    return () => {
      clearTimeout(asyncId);
      if (cycleRef.current) {
        clearInterval(cycleRef.current);
        cycleRef.current = null;
      }
    };
  }, [scheduleCycle]);

  const activeStepData = workflowSteps[activeStep] ?? workflowSteps[0];

  return (
    <motion.section
      initial={{ opacity: 0, y: 40 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, delay: 0.6, ease: 'easeOut' }}
      className="max-w-5xl mx-auto mt-16 px-4 sm:px-6"
    >
      <div className="bg-white/95 border border-gray-200 rounded-3xl shadow-xl p-6 sm:p-10 md:p-12 backdrop-blur-sm space-y-8">
        <div className="text-center max-w-3xl mx-auto flex flex-col items-center gap-3">
          <span className="inline-flex items-center justify-center px-3 py-1 text-[11px] font-semibold tracking-[0.25em] uppercase bg-gray-900 text-white rounded-full">
            Request Workflow
          </span>
          <button
            type="button"
            onClick={() => setIsHidden(prev => !prev)}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-900 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900/70 focus-visible:ring-offset-2 rounded-full px-3 py-1"
          >
            {isHidden ? (
              <>
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" /><path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" /></svg>
                Show Workflow
              </>
            ) : (
              <>
                <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06l-1.745-1.745a10.029 10.029 0 003.3-4.38 1.651 1.651 0 000-1.185A10.004 10.004 0 009.999 3a9.956 9.956 0 00-4.744 1.194L3.28 2.22zM7.752 6.69l1.092 1.092a2.5 2.5 0 013.374 3.373l1.092 1.092a4 4 0 00-5.558-5.558z" clipRule="evenodd" /><path d="M10.748 13.93l2.523 2.523A9.987 9.987 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41a1.651 1.651 0 010-1.186 10.007 10.007 0 012.89-4.042L5.87 7.68a4.001 4.001 0 004.878 6.25z" /></svg>
                Hide Workflow
              </>
            )}
          </button>
        </div>

        {!isHidden && (
          <div className="space-y-10">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
              {workflowSteps.map((step, index) => {
                const isActive = activeStep === index;
                return (
                  <motion.button
                    key={step.title}
                    type="button"
                    onClick={() => handleStepChange(index)}
                    whileHover={{ scale: isActive ? 1.01 : 1.05 }}
                    whileTap={{ scale: 0.97 }}
                    aria-pressed={isActive}
                    className={`flex w-full sm:w-auto justify-center items-center gap-2 rounded-full border px-4 py-2 text-sm sm:text-base font-semibold transition-all duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900/70 focus-visible:ring-offset-2 focus-visible:ring-offset-white ${isActive
                      ? 'border-gray-900 bg-gray-900 text-white shadow-lg'
                      : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:text-gray-900'
                      }`}
                  >
                    <span className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold text-white ${step.color}`}>
                      {index + 1}
                    </span>
                    {step.title}
                  </motion.button>
                );
              })}
            </div>

            <motion.div
              key={activeStep}
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
              className="relative"
            >
              <div className="relative rounded-3xl border border-gray-200 overflow-hidden shadow-[0_32px_70px_rgba(15,23,42,0.12)] bg-white">
                <div className="absolute inset-x-0 top-0 h-1 bg-gray-100">
                  <motion.div
                    key={`${activeStep}-${progressCycle}`}
                    initial={{ width: '0%' }}
                    animate={{ width: isPaused ? undefined : '100%' }}
                    transition={{ duration: STEP_INTERVAL_MS / 1000, ease: 'linear' }}
                    style={isPaused ? { animationPlayState: 'paused' } : undefined}
                    className={`h-full ${activeStepData.color}`}
                  />
                </div>
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 sm:px-6 py-4 border-b border-gray-200 bg-gray-50">
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-400" />
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                    </div>
                    <span className="text-xs sm:text-sm font-medium tracking-wide text-gray-600">
                      {activeStepData.window.subtitle}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <motion.button
                      type="button"
                      onClick={() => setIsPaused(prev => !prev)}
                      whileHover={{ scale: 1.1 }}
                      whileTap={{ scale: 0.9 }}
                      aria-label={isPaused ? 'Resume workflow' : 'Pause workflow'}
                      className="flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 bg-white text-gray-500 shadow-sm transition-colors hover:border-gray-300 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-900/70 focus-visible:ring-offset-2"
                    >
                      {isPaused ? (
                        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
                        </svg>
                      ) : (
                        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M5.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75A.75.75 0 007.25 3h-1.5zM12.75 3a.75.75 0 00-.75.75v12.5c0 .414.336.75.75.75h1.5a.75.75 0 00.75-.75V3.75a.75.75 0 00-.75-.75h-1.5z" />
                        </svg>
                      )}
                    </motion.button>
                    <span className={`${MICRO_LABEL_CLASS} text-gray-600`}>Live Preview</span>
                  </div>
                </div>

                <div className="p-6 sm:p-8 space-y-7">
                  <div>
                    <h3 className="text-2xl font-semibold text-gray-900">
                      {activeStepData.window.title}
                    </h3>
                    <p className={`mt-2 ${BODY_TEXT_CLASS}`}>
                      {activeStepData.window.summary}
                    </p>
                    <p className="mt-3 text-sm text-gray-600">
                      {activeStepData.caption}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-gray-200 bg-gray-50/80 p-4 sm:p-6 shadow-inner">
                    {activeStepData.window.content(isPaused)}
                  </div>

                  <div className="grid gap-6 lg:grid-cols-2">
                    <div>
                      <p className={`${META_LABEL_CLASS} text-gray-600 mb-3`}>What you do</p>
                      <ul className="space-y-3">
                        {activeStepData.window.userSteps.map(step => (
                          <li key={step} className="flex items-start gap-3">
                            <span className={`mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-white ${activeStepData.color}`}>
                              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3-3a1 1 0 011.414-1.414l2.293 2.293 6.543-6.543a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            </span>
                            <p className={BODY_TEXT_CLASS}>
                              {step}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>

                    <div>
                      <p className={`${META_LABEL_CLASS} text-gray-600 mb-3`}>What we do</p>
                      <ul className="space-y-3">
                        {activeStepData.window.teamSteps.map(step => (
                          <li key={step} className="flex items-start gap-3">
                            <span className={`mt-1 inline-flex h-6 w-6 items-center justify-center rounded-full text-white ${activeStepData.color}`}>
                              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-7.25 7.25a1 1 0 01-1.414 0l-3-3a1 1 0 011.414-1.414l2.293 2.293 6.543-6.543a1 1 0 011.414 0z" clipRule="evenodd" />
                              </svg>
                            </span>
                            <p className={BODY_TEXT_CLASS}>
                              {step}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </div>
    </motion.section>
  );
}
