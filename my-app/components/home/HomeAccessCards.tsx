'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import {
  readClientSessionState,
  SESSION_STATE_EVENT,
  type ClientSessionState,
} from '@/lib/client-session-state';

type IconName = 'internal' | 'external' | 'document' | 'support' | 'profile' | 'key' | 'help';

type AccessCard = {
  href: string;
  title: string;
  description: ReactNode;
  action: string;
  icon: IconName;
  borderClass: string;
  iconClass: string;
  buttonClass: string;
};

const publicCards: AccessCard[] = [
  {
    href: '/request/internal',
    title: 'Internal Student',
    description: (
      <>
        Currently enrolled at Cal Poly Pomona with an <span className="font-bold">@cpp.edu</span> email address
      </>
    ),
    action: 'Request Access',
    icon: 'internal',
    borderClass: 'hover:border-black dark:hover:border-gray-500',
    iconClass: 'bg-black dark:bg-gray-700',
    buttonClass: 'bg-black group-hover:bg-gray-800 dark:bg-gray-700 dark:group-hover:bg-gray-600',
  },
  {
    href: '/request/external',
    title: 'External Student',
    description: 'Non-Cal Poly Pomona Students or external participants requiring temporary access',
    action: 'Request Access',
    icon: 'external',
    borderClass: 'hover:border-black dark:hover:border-gray-500',
    iconClass: 'bg-black dark:bg-gray-700',
    buttonClass: 'bg-black group-hover:bg-gray-800 dark:bg-gray-700 dark:group-hover:bg-gray-600',
  },
];

const authenticatedCards: AccessCard[] = [
  {
    href: '/instructions',
    title: 'VPN Instructions',
    description: 'View your VPN credentials and setup instructions',
    action: 'View Instructions',
    icon: 'document',
    borderClass: 'hover:border-blue-700',
    iconClass: 'bg-blue-700',
    buttonClass: 'bg-blue-700 group-hover:bg-blue-800',
  },
  {
    href: '/support/tickets',
    title: 'Support Tickets',
    description: 'View and manage your support requests',
    action: 'My Tickets',
    icon: 'support',
    borderClass: 'hover:border-green-700',
    iconClass: 'bg-green-700',
    buttonClass: 'bg-green-700 group-hover:bg-green-800',
  },
  {
    href: '/profile',
    title: 'My Profile',
    description: 'Manage your account settings and information',
    action: 'View Profile',
    icon: 'profile',
    borderClass: 'hover:border-purple-700',
    iconClass: 'bg-purple-700',
    buttonClass: 'bg-purple-700 group-hover:bg-purple-800',
  },
  {
    href: '/forgot-password',
    title: 'Reset Password',
    description: 'Change or reset your account password',
    action: 'Reset Password',
    icon: 'key',
    borderClass: 'hover:border-orange-700',
    iconClass: 'bg-orange-700',
    buttonClass: 'bg-orange-700 group-hover:bg-orange-800',
  },
  {
    href: '/support/create',
    title: 'Get Help',
    description: 'Create a new support ticket for assistance',
    action: 'Create Ticket',
    icon: 'help',
    borderClass: 'hover:border-red-700',
    iconClass: 'bg-red-700',
    buttonClass: 'bg-red-700 group-hover:bg-red-800',
  },
];

function AccessIcon({ icon }: { icon: IconName }) {
  if (icon === 'external') {
    return (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    );
  }

  if (icon === 'document') {
    return (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    );
  }

  if (icon === 'support') {
    return (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z"
      />
    );
  }

  if (icon === 'key') {
    return (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"
      />
    );
  }

  if (icon === 'help') {
    return (
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
      />
    );
  }

  return (
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
    />
  );
}

function AccessCard({ card }: { card: AccessCard }) {
  return (
    <Link href={card.href} className="group block h-full">
      <div
        className={`flex h-full flex-col rounded-lg border-2 border-transparent bg-card p-6 text-card-foreground shadow-lg transition-[border-color,box-shadow] duration-300 hover:shadow-xl dark:border-border dark:shadow-black/30 sm:p-8 ${card.borderClass}`}
      >
        <div
          className={`mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full transition-transform duration-300 group-hover:scale-110 sm:mb-6 sm:h-16 sm:w-16 ${card.iconClass}`}
        >
          <svg className="h-7 w-7 text-white sm:h-8 sm:w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <AccessIcon icon={card.icon} />
          </svg>
        </div>
        <h3 className="mb-2 text-center text-xl font-bold text-gray-900 dark:text-gray-50 sm:mb-3 sm:text-2xl">
          {card.title}
        </h3>
        <p className="mb-4 text-center text-sm text-gray-700 dark:text-gray-300 sm:mb-6 sm:text-base">
          {card.description}
        </p>
        <div className="mt-auto text-center">
          <span
            className={`inline-block rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-colors sm:px-6 sm:py-3 sm:text-base ${card.buttonClass}`}
          >
            {card.action} &rarr;
          </span>
        </div>
      </div>
    </Link>
  );
}

export function HomeAccessCards() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return readClientSessionState()?.isAuthenticated ?? false;
  });

  useEffect(() => {
    const applySessionState = (state: ClientSessionState | undefined) => {
      if (state) {
        setIsAuthenticated(state.isAuthenticated);
      }
    };

    const handleSessionState = (event: Event) => {
      const detail = (event as CustomEvent<ClientSessionState>).detail;
      applySessionState(detail ?? readClientSessionState());
    };

    window.addEventListener(SESSION_STATE_EVENT, handleSessionState);
    return () => window.removeEventListener(SESSION_STATE_EVENT, handleSessionState);
  }, []);

  const cards = isAuthenticated ? authenticatedCards : publicCards;
  const gridClass = isAuthenticated ? 'md:grid-cols-2 lg:grid-cols-3' : 'md:grid-cols-2';

  return (
    <>
      <p className="mx-auto mb-8 mt-4 max-w-3xl px-4 text-center text-sm leading-relaxed text-gray-700 dark:text-gray-300 sm:text-base md:text-lg">
        {isAuthenticated
          ? 'Welcome back! Quick access to commonly used features.'
          : 'Select your student category below to start your access request.'}
      </p>

      <div className={`mx-auto mt-8 grid max-w-5xl grid-cols-1 gap-6 sm:mt-12 sm:gap-8 ${gridClass}`}>
        {cards.map(card => (
          <AccessCard key={card.href} card={card} />
        ))}
      </div>
    </>
  );
}
