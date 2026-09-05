import type { ToastType } from '@/components/Toast';
import { fetchWithCsrf } from '@/lib/csrf';

interface ManualAssignmentConfirmation {
  title: string;
  message: string;
  type: 'username-mismatch';
  onConfirm: () => Promise<void>;
}

interface ManualAssignmentActionsOptions {
  requestId: string;
  actionLoading: boolean;
  isInternal: boolean;
  linkedAdUsername: string;
  linkedVpnUsername: string;
  manualAssignmentNotes: string;
  adUsernameCheckMessage: string;
  vpnUsernameCheckMessage: string;
  showToast: (message: string, type?: ToastType) => void;
  hideManualAssignment: () => void;
  resetManualAssignmentDraft: () => void;
  openConfirmation: (confirmation: ManualAssignmentConfirmation) => void;
  closeConfirmation: () => void;
  onActionStart: () => void;
  onActionComplete: () => void;
  onActionError: (message: string) => void;
  redirectToAdmin: () => void;
}

interface ManualAssignmentResponse {
  error?: string;
  message?: string;
  warning?: boolean;
  requiresConfirmation?: boolean;
  suggestion?: string;
  providedUsername?: string;
  warnings?: string[];
}

interface ManualAssignmentBody {
  linkedAdUsername: string;
  notes: string | null;
  linkedVpnUsername?: string;
}

function showAssignmentResult(
  data: ManualAssignmentResponse,
  showToast: (message: string, type?: ToastType) => void,
) {
  if (data.warnings && data.warnings.length > 0) {
    showToast(
      `Request linked successfully, but some directory operations failed:\n${data.warnings.join('\n')}`,
      'warning',
    );
    console.warn('[Manual Assignment] LDAP warnings:', data.warnings);
    return;
  }
  showToast(data.message || 'Request successfully linked to existing account!', 'success');
}

export function createManualAssignmentActions({
  requestId,
  actionLoading,
  isInternal,
  linkedAdUsername,
  linkedVpnUsername,
  manualAssignmentNotes,
  adUsernameCheckMessage,
  vpnUsernameCheckMessage,
  showToast,
  hideManualAssignment,
  resetManualAssignmentDraft,
  openConfirmation,
  closeConfirmation,
  onActionStart,
  onActionComplete,
  onActionError,
  redirectToAdmin,
}: ManualAssignmentActionsOptions) {
  const submitManualAssignment = async () => {
    if (actionLoading) return;
    if (!linkedAdUsername.trim()) {
      showToast('Please enter an Active Directory username', 'warning');
      return;
    }
    if (!adUsernameCheckMessage?.includes('exists')) {
      showToast('Please verify the Active Directory username exists first', 'warning');
      return;
    }
    if (!isInternal && linkedVpnUsername.trim() && !vpnUsernameCheckMessage?.includes('exists')) {
      showToast('Please verify the VPN username exists first', 'warning');
      return;
    }

    const requestBody: ManualAssignmentBody = {
      linkedAdUsername: linkedAdUsername.trim(),
      notes: manualAssignmentNotes.trim() || null,
    };
    if (!isInternal && linkedVpnUsername.trim()) {
      requestBody.linkedVpnUsername = linkedVpnUsername.trim();
    }

    hideManualAssignment();
    onActionStart();
    try {
      const response = await fetchWithCsrf(`/api/admin/requests/${requestId}/manual-assign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
      if (!response.ok) {
        const data = await response.json() as ManualAssignmentResponse;
        if (response.status === 409 && data.requiresConfirmation && data.warning) {
          openConfirmation({
            title: '⚠️ Username Mismatch Detected',
            message: `${data.error}\n\n${data.message}\n\nExpected username: ${data.suggestion}\nYou entered: ${data.providedUsername}\n\nAre you sure you want to proceed with this manual assignment?`,
            type: 'username-mismatch',
            onConfirm: async () => {
              closeConfirmation();
              onActionStart();
              try {
                const forceResponse = await fetchWithCsrf(`/api/admin/requests/${requestId}/manual-assign`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ ...requestBody, forceAssignment: true }),
                });
                if (!forceResponse.ok) {
                  const forceData = await forceResponse.json() as ManualAssignmentResponse;
                  throw new Error(forceData.error || 'Failed to manually assign request');
                }
                showAssignmentResult(await forceResponse.json() as ManualAssignmentResponse, showToast);
                resetManualAssignmentDraft();
                setTimeout(redirectToAdmin, 2_000);
              } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to manually assign request';
                showToast(message, 'error');
                onActionError(message);
              } finally {
                onActionComplete();
              }
            },
          });
          return;
        }
        throw new Error(data.error || 'Failed to manually assign request');
      }

      showAssignmentResult(await response.json() as ManualAssignmentResponse, showToast);
      resetManualAssignmentDraft();
      setTimeout(redirectToAdmin, 2_000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to manually assign request';
      showToast(message, 'error');
      onActionError(message);
    } finally {
      onActionComplete();
    }
  };

  return { submitManualAssignment };
}
