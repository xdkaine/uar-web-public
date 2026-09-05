import { beforeEach, expect, it, vi } from 'vitest';
import type { AccessRequest } from './RequestDetailTypes';

const { fetchWithCsrf } = vi.hoisted(() => ({ fetchWithCsrf: vi.fn() }));

vi.mock('@/lib/csrf', () => ({ fetchWithCsrf }));

import { createAccountSetupActions } from './accountSetupActions';

const request: AccessRequest = {
  id: 'request-1', version: 1, createdAt: '2026-09-04T00:00:00.000Z', updatedAt: '2026-09-04T00:00:00.000Z',
  name: 'Taylor Example', email: 'taylor@example.test', isInternal: false, needsDomainAccount: false,
  isVerified: true, status: 'pending_faculty', acknowledgedByDirector: true,
};

function response(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeActions(overrides: Partial<Parameters<typeof createAccountSetupActions>[0]> = {}) {
  let confirmation: { title: string; message: string; onConfirm: () => Promise<void> } | undefined;
  const showToast = vi.fn();
  const closeConfirmation = vi.fn();
  const onActionStart = vi.fn();
  const onActionComplete = vi.fn();
  const onActionError = vi.fn();
  const refreshRequest = vi.fn().mockResolvedValue(undefined);
  const redirectToAdmin = vi.fn();
  const actions = createAccountSetupActions({
    requestId: 'request-1',
    request,
    vpnModuleEnabled: true,
    ldapUsername: 'taylor-ad',
    vpnUsername: 'taylor-vpn',
    password: 'operator-password',
    usernameCheckMessage: 'Username is available',
    expirationDateTime: '2026-09-10T17:04',
    showToast,
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

it('blocks create before confirmation when the availability check is absent', () => {
  const fixture = makeActions({ usernameCheckMessage: '' });

  fixture.actions.handleCreateAccount();

  expect(fixture.confirmation).toBeUndefined();
  expect(fixture.showToast).toHaveBeenCalledWith('Please check username availability first', 'warning');
  expect(fetchWithCsrf).not.toHaveBeenCalled();
});

it.each([undefined, null])('keeps an unavailable username-check message (%s) fail-closed', (message) => {
  const fixture = makeActions({ usernameCheckMessage: message as unknown as string });

  expect(() => fixture.actions.handleCreateAccount()).not.toThrow();
  expect(fixture.confirmation).toBeUndefined();
  expect(fixture.showToast).toHaveBeenCalledWith('Please check username availability first', 'warning');
  expect(fetchWithCsrf).not.toHaveBeenCalled();
});

it('captures create inputs, saves credentials before account creation, and redirects after two seconds', async () => {
  vi.useFakeTimers();
  fetchWithCsrf.mockResolvedValueOnce(response({ success: true }));
  fetchWithCsrf.mockResolvedValueOnce(response({ message: 'Synthetic account created' }));
  const fixture = makeActions();

  fixture.actions.handleCreateAccount();
  expect(fixture.confirmation).toMatchObject({ title: 'Create AD Account' });
  await fixture.confirmation?.onConfirm();

  expect(fetchWithCsrf).toHaveBeenNthCalledWith(1, '/api/admin/requests/request-1/save-credentials', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ldapUsername: 'taylor-ad',
      password: 'operator-password',
      expirationDate: '2026-09-10T17:04:00',
      vpnUsername: 'taylor-vpn',
    }),
  });
  expect(fetchWithCsrf).toHaveBeenNthCalledWith(2, '/api/admin/requests/request-1/create-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  expect(fixture.closeConfirmation).toHaveBeenCalledOnce();
  expect(fixture.onActionStart).toHaveBeenCalledOnce();
  expect(fixture.onActionComplete).toHaveBeenCalledOnce();
  expect(fixture.showToast).toHaveBeenCalledWith('Synthetic account created', 'success');
  expect(fixture.redirectToAdmin).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(fixture.redirectToAdmin).toHaveBeenCalledOnce();
});

it('stops create after a credential-save failure without attempting account creation', async () => {
  fetchWithCsrf.mockResolvedValueOnce(response({ error: 'Synthetic save failure' }, 500));
  const fixture = makeActions();

  fixture.actions.handleCreateAccount();
  await fixture.confirmation?.onConfirm();

  expect(fetchWithCsrf).toHaveBeenCalledTimes(1);
  expect(fixture.showToast).toHaveBeenCalledWith('Synthetic save failure', 'error');
  expect(fixture.onActionError).toHaveBeenCalledWith('Synthetic save failure');
  expect(fixture.onActionComplete).toHaveBeenCalledOnce();
});

it('updates with a disabled VPN module as null and refreshes after a successful response', async () => {
  fetchWithCsrf.mockResolvedValueOnce(response({ success: true, message: 'Synthetic update complete' }));
  const fixture = makeActions({ vpnModuleEnabled: false, usernameCheckMessage: '' });

  fixture.actions.handleUpdateAccount();
  expect(fixture.confirmation).toMatchObject({ title: 'Update directory account' });
  await fixture.confirmation?.onConfirm();

  expect(fetchWithCsrf).toHaveBeenCalledWith('/api/admin/requests/request-1/update-account', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      newLdapUsername: 'taylor-ad',
      newVpnUsername: null,
      newPassword: 'operator-password',
      newExpirationDate: '2026-09-10T17:04:00',
    }),
  });
  expect(fixture.refreshRequest).toHaveBeenCalledOnce();
  expect(fixture.showToast).toHaveBeenCalledWith('Synthetic update complete', 'success');
});

it('treats a 202 or false success update as reconciliation-required', async () => {
  fetchWithCsrf.mockResolvedValueOnce(response({ success: false, error: 'Synthetic update unknown' }, 202));
  const fixture = makeActions();

  fixture.actions.handleUpdateAccount();
  await fixture.confirmation?.onConfirm();

  expect(fixture.refreshRequest).not.toHaveBeenCalled();
  expect(fixture.showToast).toHaveBeenCalledWith('Synthetic update unknown', 'error');
  expect(fixture.onActionError).toHaveBeenCalledWith('Synthetic update unknown');
});
