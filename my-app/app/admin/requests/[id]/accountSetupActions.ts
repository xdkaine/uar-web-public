import type { ToastType } from '@/components/Toast';
import { fetchWithCsrf } from '@/lib/csrf';
import type { AccessRequest } from './RequestDetailTypes';

interface AccountSetupConfirmation {
  title: string;
  message: string;
  onConfirm: () => Promise<void>;
}

interface AccountSetupActionsOptions {
  requestId: string;
  request: AccessRequest | null;
  vpnModuleEnabled: boolean;
  ldapUsername: string;
  vpnUsername: string;
  password: string;
  usernameCheckMessage: string;
  expirationDateTime: string;
  showToast: (message: string, type?: ToastType) => void;
  openConfirmation: (confirmation: AccountSetupConfirmation) => void;
  closeConfirmation: () => void;
  onActionStart: () => void;
  onActionComplete: () => void;
  onActionError: (message: string) => void;
  refreshRequest: () => Promise<void>;
  redirectToAdmin: () => void;
}

interface ErrorResponse {
  error?: string;
}

interface SuccessResponse extends ErrorResponse {
  success?: boolean;
  message?: string;
}

function validateAccountDraft({
  request,
  vpnModuleEnabled,
  ldapUsername,
  vpnUsername,
  password,
  expirationDateTime,
  usernameCheckMessage,
  showToast,
  requireAvailabilityCheck,
}: Pick<AccountSetupActionsOptions, 'request' | 'vpnModuleEnabled' | 'ldapUsername' | 'vpnUsername' | 'password' | 'expirationDateTime' | 'usernameCheckMessage' | 'showToast'> & { requireAvailabilityCheck: boolean }) {
  if (!ldapUsername.trim()) {
    showToast('Please enter an account username', 'warning');
    return false;
  }
  if (vpnModuleEnabled && !request?.isInternal && !vpnUsername.trim()) {
    showToast('Please enter a VPN username for external users', 'warning');
    return false;
  }
  if (!password.trim()) {
    showToast('Please enter or generate a password', 'warning');
    return false;
  }
  if (!request?.isInternal && !expirationDateTime) {
    showToast('Please set an account disable date and time for external users', 'warning');
    return false;
  }
  if (requireAvailabilityCheck && !usernameCheckMessage?.includes('available')) {
    showToast('Please check username availability first', 'warning');
    return false;
  }
  return true;
}

export function createAccountSetupActions(options: AccountSetupActionsOptions) {
  const {
    requestId,
    request,
    vpnModuleEnabled,
    ldapUsername,
    vpnUsername,
    password,
    usernameCheckMessage,
    expirationDateTime,
    showToast,
    openConfirmation,
    closeConfirmation,
    onActionStart,
    onActionComplete,
    onActionError,
    refreshRequest,
    redirectToAdmin,
  } = options;

  const handleCreateAccount = () => {
    if (!validateAccountDraft({
      request,
      vpnModuleEnabled,
      ldapUsername,
      vpnUsername,
      password,
      expirationDateTime,
      usernameCheckMessage,
      showToast,
      requireAvailabilityCheck: true,
    })) return;

    openConfirmation({
      title: 'Create AD Account',
      message: `Are you sure you want to create the AD account for "${ldapUsername}"? This will create the account in Active Directory with the specified password.`,
      onConfirm: async () => {
        closeConfirmation();
        onActionStart();
        try {
          const requestBody: Record<string, string | null> = {
            ldapUsername,
            password,
            expirationDate: !request?.isInternal ? new Date(expirationDateTime).toISOString() : null,
          };
          if (!request?.isInternal && vpnModuleEnabled) requestBody.vpnUsername = vpnUsername;

          const saveResponse = await fetchWithCsrf(`/api/admin/requests/${requestId}/save-credentials`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody),
          });
          if (!saveResponse.ok) {
            const data = await saveResponse.json() as ErrorResponse;
            throw new Error(data.error || 'Failed to save credentials');
          }

          const createResponse = await fetchWithCsrf(`/api/admin/requests/${requestId}/create-account`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
          });
          if (!createResponse.ok) {
            const data = await createResponse.json() as ErrorResponse;
            throw new Error(data.error || 'Failed to create an AD account');
          }

          const data = await createResponse.json() as SuccessResponse;
          showToast(data.message || 'Directory account created successfully and moved to the next review stage.', 'success');
          setTimeout(redirectToAdmin, 2_000);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to create account';
          showToast(message, 'error');
          onActionError(message);
        } finally {
          onActionComplete();
        }
      },
    });
  };

  const handleUpdateAccount = () => {
    if (!validateAccountDraft({
      request,
      vpnModuleEnabled,
      ldapUsername,
      vpnUsername,
      password,
      expirationDateTime,
      usernameCheckMessage,
      showToast,
      requireAvailabilityCheck: false,
    })) return;

    openConfirmation({
      title: 'Update directory account',
      message: `Are you sure you want to update the directory account for "${ldapUsername}"? This will update the password and account disable date in Active Directory.`,
      onConfirm: async () => {
        closeConfirmation();
        onActionStart();
        try {
          const updateResponse = await fetchWithCsrf(`/api/admin/requests/${requestId}/update-account`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              newLdapUsername: ldapUsername,
              newVpnUsername: vpnModuleEnabled ? vpnUsername : null,
              newPassword: password,
              newExpirationDate: !request?.isInternal ? new Date(expirationDateTime).toISOString() : null,
            }),
          });

          const data = await updateResponse.json() as SuccessResponse;
          if (!updateResponse.ok || updateResponse.status === 202 || data.success === false) {
            throw new Error(data.error || 'Account update requires operator reconciliation');
          }
          showToast(data.message || 'Directory account updated successfully!', 'success');
          await refreshRequest();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to update account';
          showToast(message, 'error');
          onActionError(message);
        } finally {
          onActionComplete();
        }
      },
    });
  };

  return { handleCreateAccount, handleUpdateAccount };
}
