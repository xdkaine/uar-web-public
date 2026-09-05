'use client';

import { useCallback, useState } from 'react';
import { fetchWithCsrf } from '@/lib/csrf';

interface ManualAssignmentRequest {
  isGrandfatheredAccount?: boolean;
  ldapUsername?: string | null;
}

interface UseManualAssignmentControllerOptions {
  requestId: string;
}

export function useManualAssignmentController({ requestId }: UseManualAssignmentControllerOptions) {
  const [showManualAssignModal, setShowManualAssignModal] = useState(false);
  const [linkedAdUsername, setLinkedAdUsername] = useState('');
  const [linkedVpnUsername, setLinkedVpnUsername] = useState('');
  const [manualAssignmentNotes, setManualAssignmentNotes] = useState('');
  const [adUsernameCheckMessage, setAdUsernameCheckMessage] = useState('');
  const [vpnUsernameCheckMessage, setVpnUsernameCheckMessage] = useState('');

  const resetManualAssignmentDraft = useCallback(() => {
    setLinkedAdUsername('');
    setLinkedVpnUsername('');
    setManualAssignmentNotes('');
    setAdUsernameCheckMessage('');
    setVpnUsernameCheckMessage('');
  }, []);

  const closeManualAssignment = useCallback(() => {
    setShowManualAssignModal(false);
    resetManualAssignmentDraft();
  }, [resetManualAssignmentDraft]);

  const reopenManualAssignment = useCallback(() => {
    setShowManualAssignModal(true);
  }, []);

  const hideManualAssignment = useCallback(() => {
    setShowManualAssignModal(false);
  }, []);

  const prefillGrandfatheredAccount = useCallback((request: ManualAssignmentRequest) => {
    if (request.isGrandfatheredAccount && request.ldapUsername) {
      setLinkedAdUsername(request.ldapUsername);
    }
  }, []);

  const checkUsernameExists = useCallback(async (
    username: string,
    setCheckMessage: (message: string) => void,
  ) => {
    if (!username.trim()) {
      setCheckMessage('');
      return;
    }

    try {
      const response = await fetchWithCsrf('/api/admin/check-username', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, requestId }),
      });
      const data = await response.json() as { message: string };
      setCheckMessage(data.message);
    } catch {
      setCheckMessage('Error checking username');
    }
  }, [requestId]);

  const checkAdUsernameExists = useCallback(
    () => checkUsernameExists(linkedAdUsername, setAdUsernameCheckMessage),
    [checkUsernameExists, linkedAdUsername],
  );
  const checkVpnUsernameExists = useCallback(
    () => checkUsernameExists(linkedVpnUsername, setVpnUsernameCheckMessage),
    [checkUsernameExists, linkedVpnUsername],
  );
  const onLinkedAdUsernameChange = useCallback((value: string) => {
    setLinkedAdUsername(value);
    setAdUsernameCheckMessage('');
  }, []);
  const onLinkedVpnUsernameChange = useCallback((value: string) => {
    setLinkedVpnUsername(value);
    setVpnUsernameCheckMessage('');
  }, []);

  return {
    showManualAssignModal,
    linkedAdUsername,
    linkedVpnUsername,
    manualAssignmentNotes,
    adUsernameCheckMessage,
    vpnUsernameCheckMessage,
    openManualAssignment: reopenManualAssignment,
    closeManualAssignment,
    hideManualAssignment,
    reopenManualAssignment,
    resetManualAssignmentDraft,
    prefillGrandfatheredAccount,
    onLinkedAdUsernameChange,
    onLinkedVpnUsernameChange,
    onManualAssignmentNotesChange: setManualAssignmentNotes,
    checkAdUsernameExists,
    checkVpnUsernameExists,
  };
}
