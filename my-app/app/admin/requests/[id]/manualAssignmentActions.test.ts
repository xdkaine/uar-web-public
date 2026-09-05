import { beforeEach, expect, it, vi } from 'vitest';

const { fetchWithCsrf } = vi.hoisted(() => ({ fetchWithCsrf: vi.fn() }));

vi.mock('@/lib/csrf', () => ({ fetchWithCsrf }));

import { createManualAssignmentActions } from './manualAssignmentActions';

function response(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeActions(overrides: Partial<Parameters<typeof createManualAssignmentActions>[0]> = {}) {
  let confirmation: { onConfirm: () => Promise<void> } | undefined;
  const showToast = vi.fn();
  const hideManualAssignment = vi.fn();
  const resetManualAssignmentDraft = vi.fn();
  const closeConfirmation = vi.fn();
  const onActionStart = vi.fn();
  const onActionComplete = vi.fn();
  const onActionError = vi.fn();
  const redirectToAdmin = vi.fn();
  const actions = createManualAssignmentActions({
    requestId: 'request-1',
    actionLoading: false,
    isInternal: false,
    linkedAdUsername: '  original-ad  ',
    linkedVpnUsername: '  original-vpn  ',
    manualAssignmentNotes: '  original notes  ',
    adUsernameCheckMessage: 'Username exists',
    vpnUsernameCheckMessage: 'Username exists',
    showToast,
    hideManualAssignment,
    resetManualAssignmentDraft,
    openConfirmation: (next) => { confirmation = next; },
    closeConfirmation,
    onActionStart,
    onActionComplete,
    onActionError,
    redirectToAdmin,
    ...overrides,
  });
  return {
    actions,
    get confirmation() { return confirmation; },
    showToast,
    hideManualAssignment,
    resetManualAssignmentDraft,
    closeConfirmation,
    onActionStart,
    onActionComplete,
    onActionError,
    redirectToAdmin,
  };
}

beforeEach(() => {
  fetchWithCsrf.mockReset();
  vi.useRealTimers();
});

it('does not close the draft or call an endpoint until AD and optional VPN checks pass', async () => {
  const fixture = makeActions({ vpnUsernameCheckMessage: 'Username available' });

  await fixture.actions.submitManualAssignment();

  expect(fetchWithCsrf).not.toHaveBeenCalled();
  expect(fixture.hideManualAssignment).not.toHaveBeenCalled();
  expect(fixture.showToast).toHaveBeenCalledWith('Please verify the VPN username exists first', 'warning');
});

it.each([
  ['adUsernameCheckMessage', undefined],
  ['adUsernameCheckMessage', null],
  ['vpnUsernameCheckMessage', undefined],
  ['vpnUsernameCheckMessage', null],
] as const)('keeps a missing %s (%s) fail-closed', async (field, value) => {
  const fixture = makeActions({ [field]: value as unknown as string });

  await expect(fixture.actions.submitManualAssignment()).resolves.toBeUndefined();
  expect(fetchWithCsrf).not.toHaveBeenCalled();
  expect(fixture.hideManualAssignment).not.toHaveBeenCalled();
  expect(fixture.showToast).toHaveBeenCalledWith(expect.stringMatching(/^Please verify/), 'warning');
});

it('captures the original attempted body when a mismatch confirmation is opened', async () => {
  fetchWithCsrf
    .mockResolvedValueOnce(response({
      error: 'Synthetic mismatch',
      message: 'Directory record differs',
      warning: true,
      requiresConfirmation: true,
      suggestion: 'suggested-ad',
      providedUsername: 'original-ad',
    }, 409))
    .mockResolvedValueOnce(response({ message: 'Synthetic success' }));
  const fixture = makeActions();

  await fixture.actions.submitManualAssignment();
  expect(fixture.confirmation).toBeDefined();
  expect(fetchWithCsrf).toHaveBeenCalledWith('/api/admin/requests/request-1/manual-assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      linkedAdUsername: 'original-ad',
      notes: 'original notes',
      linkedVpnUsername: 'original-vpn',
    }),
  });

  await fixture.confirmation?.onConfirm();

  expect(fetchWithCsrf).toHaveBeenLastCalledWith('/api/admin/requests/request-1/manual-assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      linkedAdUsername: 'original-ad',
      notes: 'original notes',
      linkedVpnUsername: 'original-vpn',
      forceAssignment: true,
    }),
  });
  expect(fixture.closeConfirmation).toHaveBeenCalledOnce();
  expect(fixture.resetManualAssignmentDraft).toHaveBeenCalledOnce();
});

it('leaves the hidden draft intact after a mismatch so cancellation can reopen it', async () => {
  fetchWithCsrf.mockResolvedValueOnce(response({
    error: 'Synthetic mismatch', message: 'Directory record differs', warning: true, requiresConfirmation: true,
  }, 409));
  const fixture = makeActions();

  await fixture.actions.submitManualAssignment();

  expect(fixture.hideManualAssignment).toHaveBeenCalledOnce();
  expect(fixture.resetManualAssignmentDraft).not.toHaveBeenCalled();
  expect(fetchWithCsrf).toHaveBeenCalledOnce();
});

it('omits VPN for internal assignments and retains the exact server failure', async () => {
  fetchWithCsrf.mockResolvedValueOnce(response({ error: 'Synthetic assignment failure' }, 500));
  const fixture = makeActions({ isInternal: true });

  await fixture.actions.submitManualAssignment();

  expect(fetchWithCsrf).toHaveBeenCalledWith('/api/admin/requests/request-1/manual-assign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ linkedAdUsername: 'original-ad', notes: 'original notes' }),
  });
  expect(fixture.showToast).toHaveBeenCalledWith('Synthetic assignment failure', 'error');
  expect(fixture.onActionError).toHaveBeenCalledWith('Synthetic assignment failure');
  expect(fixture.resetManualAssignmentDraft).not.toHaveBeenCalled();
});
