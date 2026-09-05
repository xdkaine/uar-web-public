import type { ToastType } from '@/components/Toast';
import { fetchWithCsrf } from '@/lib/csrf';

interface ReviewConfirmation {
  title: string;
  message: string;
  onConfirm: () => Promise<void>;
}

interface RequestReviewActionsOptions {
  requestId: string;
  approvalMessage: string;
  rejectionReason: string;
  showToast: (message: string, type?: ToastType) => void;
  setShowApproveModal: (value: boolean) => void;
  setShowRejectModal: (value: boolean) => void;
  setApprovalMessage: (value: string) => void;
  setRejectionReason: (value: string) => void;
  openConfirmation: (confirmation: ReviewConfirmation) => void;
  closeConfirmation: () => void;
  onActionStart: () => void;
  onActionComplete: () => void;
  onActionError: (message: string) => void;
  refreshRequest: () => Promise<void>;
  redirectToAdmin: () => void;
}

interface ResponseData {
  error?: string;
  message?: string;
}

export function createRequestReviewActions({
  requestId,
  approvalMessage,
  rejectionReason,
  showToast,
  setShowApproveModal,
  setShowRejectModal,
  setApprovalMessage,
  setRejectionReason,
  openConfirmation,
  closeConfirmation,
  onActionStart,
  onActionComplete,
  onActionError,
  refreshRequest,
  redirectToAdmin,
}: RequestReviewActionsOptions) {
  const closeApproveModal = () => {
    setShowApproveModal(false);
    setApprovalMessage('');
  };

  const closeRejectModal = () => {
    setShowRejectModal(false);
    setRejectionReason('');
  };

  const submitApproval = async () => {
    setShowApproveModal(false);
    onActionStart();
    const messageToSend = approvalMessage.trim() || 'Request approved.';

    try {
      const response = await fetchWithCsrf(`/api/admin/requests/${requestId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: messageToSend }),
      });
      if (!response.ok) {
        const data = await response.json() as ResponseData;
        throw new Error(data.error || 'Failed to approve request');
      }

      showToast('Request approved successfully! User will receive an email notification.', 'success');
      setApprovalMessage('');
      await refreshRequest();
      setTimeout(redirectToAdmin, 2_000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to approve request';
      showToast(message, 'error');
      onActionError(message);
    } finally {
      onActionComplete();
    }
  };

  const submitRejection = async () => {
    if (!rejectionReason.trim()) {
      showToast('Please provide a rejection reason', 'warning');
      return;
    }

    setShowRejectModal(false);
    onActionStart();
    try {
      const response = await fetchWithCsrf(`/api/admin/requests/${requestId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: rejectionReason }),
      });
      if (!response.ok) {
        const data = await response.json() as ResponseData;
        throw new Error(data.error || 'Failed to reject request');
      }

      showToast('Request rejected successfully. Notification email sent.', 'success');
      setRejectionReason('');
      await refreshRequest();
      setTimeout(redirectToAdmin, 2_000);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to reject request';
      showToast(message, 'error');
      onActionError(message);
    } finally {
      onActionComplete();
    }
  };

  const openMoveBackConfirmation = () => {
    openConfirmation({
      title: 'Move Back to Student Directors',
      message: 'Move this request back to Student Directors stage? The credentials will be preserved so they can be edited.',
      onConfirm: async () => {
        closeConfirmation();
        onActionStart();
        try {
          const response = await fetchWithCsrf(`/api/admin/requests/${requestId}/move-back`, { method: 'POST' });
          if (!response.ok) {
            const data = await response.json() as ResponseData;
            throw new Error(data.error || 'Failed to move request back');
          }

          const data = await response.json() as ResponseData;
          showToast(data.message || 'Request moved back to Student Directors stage.', 'success');
          setTimeout(redirectToAdmin, 1_500);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to move request back';
          showToast(message, 'error');
          onActionError(message);
        } finally {
          onActionComplete();
        }
      },
    });
  };

  const openReturnToFacultyConfirmation = () => {
    openConfirmation({
      title: 'Return to Faculty Review',
      message: 'Are you sure you want to return this request to the Faculty Review stage? This will notify the faculty member.',
      onConfirm: async () => {
        closeConfirmation();
        onActionStart();
        try {
          const response = await fetchWithCsrf(`/api/admin/requests/${requestId}/return-to-faculty`, { method: 'POST' });
          if (!response.ok) {
            const data = await response.json() as ResponseData;
            throw new Error(data.error || 'Failed to return request to faculty');
          }

          const data = await response.json() as ResponseData;
          showToast(data.message || 'Request returned to Faculty Review.', 'success');
          await refreshRequest();
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to return request to faculty';
          showToast(message, 'error');
          onActionError(message);
        } finally {
          onActionComplete();
        }
      },
    });
  };

  return {
    handleApprove: () => setShowApproveModal(true),
    handleReject: () => setShowRejectModal(true),
    onApproveOpenChange: (open: boolean) => { if (!open) closeApproveModal(); },
    onRejectOpenChange: (open: boolean) => { if (!open) closeRejectModal(); },
    closeApproveModal,
    closeRejectModal,
    submitApproval,
    submitRejection,
    openMoveBackConfirmation,
    openReturnToFacultyConfirmation,
  };
}
