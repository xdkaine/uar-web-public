'use client';

import { useCallback, useReducer } from 'react';
import type { ToastType } from '@/components/Toast';
import { fetchWithCsrf } from '@/lib/csrf';
import {
  accountDraftReducer,
  initialAccountDraftState,
  type AccountDraftRequest,
} from './accountDraftState';

interface UseRequestAccountDraftOptions {
  requestId: string;
  showToast: (message: string, type?: ToastType) => void;
}

interface UseRequestAccountDraftResult {
  ldapUsername: string;
  vpnUsername: string;
  password: string;
  usernameCheckMessage: string;
  expirationDateTime: string;
  showPassword: boolean;
  hydrateFromRequest: (request: AccountDraftRequest, now?: Date) => void;
  onLdapUsernameChange: (value: string) => void;
  onVpnUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onTogglePassword: () => void;
  onExpirationDateTimeChange: (value: string) => void;
  checkUsernameAvailability: () => Promise<void>;
  generatePassword: () => Promise<void>;
}

interface UsernameAvailabilityResponse {
  message: string;
}

interface GeneratedPasswordResponse {
  password: string;
}

export function useRequestAccountDraft({
  requestId,
  showToast,
}: UseRequestAccountDraftOptions): UseRequestAccountDraftResult {
  const [draft, dispatch] = useReducer(accountDraftReducer, initialAccountDraftState);

  const hydrateFromRequest = useCallback((request: AccountDraftRequest, now = new Date()) => {
    dispatch({ type: 'hydrated', request, now });
  }, []);

  const onLdapUsernameChange = useCallback((value: string) => {
    dispatch({ type: 'ldapUsernameChanged', value });
  }, []);

  const onVpnUsernameChange = useCallback((value: string) => {
    dispatch({ type: 'vpnUsernameChanged', value });
  }, []);

  const onPasswordChange = useCallback((value: string) => {
    dispatch({ type: 'passwordChanged', value });
  }, []);

  const onTogglePassword = useCallback(() => {
    dispatch({ type: 'passwordVisibilityToggled' });
  }, []);

  const onExpirationDateTimeChange = useCallback((value: string) => {
    dispatch({ type: 'expirationDateTimeChanged', value });
  }, []);

  const checkUsernameAvailability = useCallback(async () => {
    if (!draft.ldapUsername.trim()) {
      dispatch({ type: 'usernameCheckMessageChanged', value: '' });
      return;
    }

    try {
      const response = await fetchWithCsrf('/api/admin/check-username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: draft.ldapUsername, requestId }),
      });

      const data = await response.json() as UsernameAvailabilityResponse;
      dispatch({ type: 'usernameCheckMessageChanged', value: data.message });
    } catch {
      dispatch({ type: 'usernameCheckMessageChanged', value: 'Error checking username' });
    }
  }, [draft.ldapUsername, requestId]);

  const generatePassword = useCallback(async () => {
    try {
      const response = await fetchWithCsrf('/api/admin/generate-password');

      if (!response.ok) {
        throw new Error('Failed to generate password');
      }

      const data = await response.json() as GeneratedPasswordResponse;
      dispatch({ type: 'passwordChanged', value: data.password });
    } catch (error) {
      showToast('Failed to generate password', 'error');
      console.error('Password generation error:', error);
    }
  }, [showToast]);

  return {
    ...draft,
    hydrateFromRequest,
    onLdapUsernameChange,
    onVpnUsernameChange,
    onPasswordChange,
    onTogglePassword,
    onExpirationDateTimeChange,
    checkUsernameAvailability,
    generatePassword,
  };
}
