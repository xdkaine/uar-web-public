import { beforeEach, expect, it, vi } from 'vitest';

const { fetchWithCsrf } = vi.hoisted(() => ({ fetchWithCsrf: vi.fn() }));

vi.mock('@/lib/csrf', () => ({ fetchWithCsrf }));

import { createRequestReviewActions } from './requestReviewActions';

function response(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeActions(overrides: Partial<Parameters<typeof createRequestReviewActions>[0]> = {}) {
  let confirmation: { title: string; message: string; onConfirm: () => Promise<void> } | undefined;
  const showToast = vi.fn();
  const setShowApproveModal = vi.fn();
  const setShowRejectModal = vi.fn();
  const setApprovalMessage = vi.fn();
  const setRejectionReason = vi.fn();
  const closeConfirmation = vi.fn();
  const onActionStart = vi.fn();
  const onActionComplete = vi.fn();
  const onActionError = vi.fn();
  const refreshRequest = vi.fn().mockResolvedValue(undefined);
  const redirectToAdmin = vi.fn();
  const actions = createRequestReviewActions({
    requestId: 'request-1',
    approvalMessage: '  operator follow-up  ',
    rejectionReason: '  raw rejection reason  ',
    showToast,
    setShowApproveModal,
    setShowRejectModal,
    setApprovalMessage,
    setRejectionReason,
    openConfirmation: (next) => { confirmation = next; },
    closeConfirmation,
    onActionStart,
    onActionComplete,
    onActionError,
    refreshRequest,
    redirectToAdmin,
    ...overrides,
  });
  return {
    actions,
    get confirmation() { return confirmation; },
    showToast,
    setShowApproveModal,
    setShowRejectModal,
    setApprovalMessage,
    setRejectionReason,
    closeConfirmation,
    onActionStart,
    onActionComplete,
    onActionError,
    refreshRequest,
    redirectToAdmin,
  };
}

beforeEach(() => {
  fetchWithCsrf.mockReset();
  vi.useRealTimers();
});

it('sends a trimmed approval message and uses the default message when approval draft is blank', async () => {
  vi.useFakeTimers();
  fetchWithCsrf.mockResolvedValueOnce(response({ success: true }));
  const fixture = makeActions({ approvalMessage: '   ' });

  await fixture.actions.submitApproval();

  expect(fetchWithCsrf).toHaveBeenCalledWith('/api/admin/requests/request-1/approve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Request approved.' }),
  });
  expect(fixture.setShowApproveModal).toHaveBeenCalledWith(false);
  expect(fixture.setApprovalMessage).toHaveBeenCalledWith('');
  expect(fixture.refreshRequest).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(fixture.redirectToAdmin).toHaveBeenCalledOnce();
});

it('requires a nonblank rejection reason without closing the modal or making a request', async () => {
  const fixture = makeActions({ rejectionReason: '  \n  ' });

  await fixture.actions.submitRejection();

  expect(fetchWithCsrf).not.toHaveBeenCalled();
  expect(fixture.setShowRejectModal).not.toHaveBeenCalled();
  expect(fixture.showToast).toHaveBeenCalledWith('Please provide a rejection reason', 'warning');
});

it('validates rejection with trim but preserves the raw rejection text in the request body', async () => {
  vi.useFakeTimers();
  fetchWithCsrf.mockResolvedValueOnce(response({ success: true }));
  const fixture = makeActions();

  await fixture.actions.submitRejection();

  expect(fetchWithCsrf).toHaveBeenCalledWith('/api/admin/requests/request-1/reject', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: '  raw rejection reason  ' }),
  });
  expect(fixture.setRejectionReason).toHaveBeenCalledWith('');
  await vi.advanceTimersByTimeAsync(2_000);
  expect(fixture.redirectToAdmin).toHaveBeenCalledOnce();
});

it('keeps a failed approval draft for retry and publishes the exact server error', async () => {
  fetchWithCsrf.mockResolvedValueOnce(response({ error: 'Synthetic approval failure' }, 500));
  const fixture = makeActions();

  await fixture.actions.submitApproval();

  expect(fixture.setApprovalMessage).not.toHaveBeenCalled();
  expect(fixture.showToast).toHaveBeenCalledWith('Synthetic approval failure', 'error');
  expect(fixture.onActionError).toHaveBeenCalledWith('Synthetic approval failure');
  expect(fixture.onActionComplete).toHaveBeenCalledOnce();
});

it('captures move-back confirmation and uses its CSRF-protected endpoint only after confirmation', async () => {
  vi.useFakeTimers();
  fetchWithCsrf.mockResolvedValueOnce(response({ message: 'Synthetic move back' }));
  const fixture = makeActions();

  fixture.actions.openMoveBackConfirmation();
  expect(fixture.confirmation).toMatchObject({ title: 'Move Back to Student Directors' });
  expect(fetchWithCsrf).not.toHaveBeenCalled();
  await fixture.confirmation?.onConfirm();

  expect(fetchWithCsrf).toHaveBeenCalledWith('/api/admin/requests/request-1/move-back', { method: 'POST' });
  expect(fixture.closeConfirmation).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1_500);
  expect(fixture.redirectToAdmin).toHaveBeenCalledOnce();
});

it('refreshes after return-to-faculty and clears decision drafts whenever either modal closes', async () => {
  fetchWithCsrf.mockResolvedValueOnce(response({ message: 'Synthetic faculty return' }));
  const fixture = makeActions();

  fixture.actions.openReturnToFacultyConfirmation();
  await fixture.confirmation?.onConfirm();
  fixture.actions.onApproveOpenChange(false);
  fixture.actions.onRejectOpenChange(false);

  expect(fetchWithCsrf).toHaveBeenCalledWith('/api/admin/requests/request-1/return-to-faculty', { method: 'POST' });
  expect(fixture.refreshRequest).toHaveBeenCalledOnce();
  expect(fixture.setShowApproveModal).toHaveBeenCalledWith(false);
  expect(fixture.setApprovalMessage).toHaveBeenCalledWith('');
  expect(fixture.setShowRejectModal).toHaveBeenCalledWith(false);
  expect(fixture.setRejectionReason).toHaveBeenCalledWith('');
});
