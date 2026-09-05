'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ToastType } from '@/components/Toast';
import { fetchWithCsrf } from '@/lib/csrf';
import { buildFacultyHandoffMessage } from './buildFacultyHandoffMessage';
import type { AccessRequest } from './RequestDetailTypes';

interface FacultyHandoffConfirmation {
  title: string;
  message: string;
  onConfirm: () => Promise<void>;
}

interface UseFacultyHandoffControllerOptions {
  requestId: string;
  request: AccessRequest | null;
  facultyHandoffTemplate: string | null;
  showToast: (message: string, type?: ToastType) => void;
  onActionStart: () => void;
  onActionComplete: () => void;
  onActionError: (message: string) => void;
  refreshRequest: () => Promise<void>;
  openConfirmation: (confirmation: FacultyHandoffConfirmation) => void;
  closeConfirmation: () => void;
}

interface UseFacultyHandoffControllerResult {
  revealedFacultyPassword: string;
  showFacultyPassword: boolean;
  revealPasswordLoading: boolean;
  showFacultyMessage: boolean;
  onToggleFacultyPassword: () => void;
  onRevealFacultyPassword: () => Promise<void>;
  onCopyFacultyMessage: () => void;
  onToggleFacultyMessage: () => void;
  generateFacultyMessage: () => string;
  onUndoNotifyFaculty: () => void;
  onNotifyFaculty: () => Promise<void>;
}

interface DeliveryResponse {
  success?: boolean;
  message?: string;
  error?: string;
}

interface RevealedPasswordResponse {
  password: string;
  error?: string;
}

function copyWithTextArea(message: string) {
  const textArea = document.createElement('textarea');
  textArea.value = message;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  document.body.appendChild(textArea);
  textArea.select();

  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textArea);
  }
}

export function useFacultyHandoffController({
  requestId,
  request,
  facultyHandoffTemplate,
  showToast,
  onActionStart,
  onActionComplete,
  onActionError,
  refreshRequest,
  openConfirmation,
  closeConfirmation,
}: UseFacultyHandoffControllerOptions): UseFacultyHandoffControllerResult {
  const [revealedFacultyPassword, setRevealedFacultyPassword] = useState('');
  const [showFacultyPassword, setShowFacultyPassword] = useState(false);
  const [revealPasswordLoading, setRevealPasswordLoading] = useState(false);
  const [showFacultyMessage, setShowFacultyMessage] = useState(false);
  const revealAttemptRef = useRef(0);

  useEffect(() => () => {
    revealAttemptRef.current += 1;
  }, []);

  useEffect(() => {
    if (!revealedFacultyPassword) return;
    const timeout = setTimeout(() => {
      setRevealedFacultyPassword('');
      setShowFacultyPassword(false);
    }, 60_000);
    return () => clearTimeout(timeout);
  }, [revealedFacultyPassword]);

  const generateFacultyMessage = useCallback(() => buildFacultyHandoffMessage({
    request,
    facultyHandoffTemplate,
    revealedFacultyPassword,
  }), [facultyHandoffTemplate, request, revealedFacultyPassword]);

  const onToggleFacultyPassword = useCallback(() => {
    setShowFacultyPassword((current) => !current);
  }, []);

  const onToggleFacultyMessage = useCallback(() => {
    setShowFacultyMessage((current) => !current);
  }, []);

  const onRevealFacultyPassword = useCallback(async () => {
    if (!request || request.isInternal) return;
    const revealAttempt = revealAttemptRef.current + 1;
    revealAttemptRef.current = revealAttempt;
    setRevealPasswordLoading(true);
    try {
      const response = await fetchWithCsrf(`/api/admin/requests/${requestId}/reveal-password`, {
        method: 'POST',
      });
      const data = await response.json() as RevealedPasswordResponse;
      if (!response.ok) throw new Error(data.error || 'Failed to reveal password');
      if (revealAttemptRef.current !== revealAttempt) return;
      setRevealedFacultyPassword(data.password);
      setShowFacultyPassword(true);
      showToast('Password revealed for 60 seconds. This action was audited.', 'warning');
    } catch (error) {
      if (revealAttemptRef.current === revealAttempt) {
        showToast(error instanceof Error ? error.message : 'Failed to reveal password', 'error');
      }
    } finally {
      setRevealPasswordLoading((current) => (
        revealAttemptRef.current === revealAttempt ? false : current
      ));
    }
  }, [request, requestId, showToast]);

  const onCopyFacultyMessage = useCallback(() => {
    if (request && !request.isInternal && !revealedFacultyPassword) {
      showToast('Reveal the audited password before copying the faculty message.', 'warning');
      return;
    }

    try {
      copyWithTextArea(generateFacultyMessage());
      showToast('Message copied to clipboard!', 'success');
    } catch {
      showToast('Failed to copy message. Please copy manually.', 'error');
    }
  }, [generateFacultyMessage, request, revealedFacultyPassword, showToast]);

  const onNotifyFaculty = useCallback(async () => {
    onActionStart();
    try {
      const response = await fetchWithCsrf(`/api/admin/requests/${requestId}/notify-faculty`, {
        method: 'POST',
      });
      const data = await response.json() as DeliveryResponse;
      if (!response.ok || response.status === 202 || data.success === false) {
        throw new Error(data.error || 'Faculty delivery requires operator reconciliation');
      }

      showToast(data.message || 'Marked as sent to faculty!', 'success');
      void refreshRequest();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to mark as sent';
      showToast(message, 'error');
      onActionError(message);
    } finally {
      onActionComplete();
    }
  }, [onActionComplete, onActionError, onActionStart, refreshRequest, requestId, showToast]);

  const onUndoNotifyFaculty = useCallback(() => {
    openConfirmation({
      title: 'Undo Sent to Faculty',
      message: 'Are you sure you want to undo the "Sent to Faculty" status?',
      onConfirm: async () => {
        closeConfirmation();
        onActionStart();
        try {
          const response = await fetchWithCsrf(`/api/admin/requests/${requestId}/undo-notify-faculty`, {
            method: 'POST',
          });

          if (!response.ok) {
            const data = await response.json() as DeliveryResponse;
            throw new Error(data.error || 'Failed to undo notification');
          }

          showToast('Successfully undid "Sent to Faculty" status.', 'success');
          void refreshRequest();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to undo notification';
          showToast(message, 'error');
          onActionError(message);
        } finally {
          onActionComplete();
        }
      },
    });
  }, [closeConfirmation, onActionComplete, onActionError, onActionStart, openConfirmation, refreshRequest, requestId, showToast]);

  return {
    revealedFacultyPassword,
    showFacultyPassword,
    revealPasswordLoading,
    showFacultyMessage,
    onToggleFacultyPassword,
    onRevealFacultyPassword,
    onCopyFacultyMessage,
    onToggleFacultyMessage,
    generateFacultyMessage,
    onUndoNotifyFaculty,
    onNotifyFaculty,
  };
}
