import { expect, it } from 'vitest';
import {
  accountDraftReducer,
  hydrateAccountDraft,
  initialAccountDraftState,
  type AccountDraftRequest,
} from './accountDraftState';


const externalRequest: AccountDraftRequest = {
  name: 'Taylor Example',
  email: 'taylor@example.test',
  isInternal: false,
};

it('hydrates saved account fields while preserving the operator password, visibility, and availability result', () => {
  const state = {
    ...initialAccountDraftState,
    password: 'operator-password',
    showPassword: true,
    usernameCheckMessage: 'Username is available',
    vpnUsername: 'prior-vpn',
    expirationDateTime: '2026-01-01T12:00',
  };
  const accountExpiresAt = '2026-09-10T17:04:00.000Z';

  const hydrated = hydrateAccountDraft(state, {
    ...externalRequest,
    ldapUsername: 'saved-ad',
    vpnUsername: 'saved-vpn',
    accountExpiresAt,
  }, new Date(2026, 8, 4, 8, 30));

  expect(hydrated).toMatchObject({
    ldapUsername: 'saved-ad',
    vpnUsername: 'saved-vpn',
    expirationDateTime: new Date(accountExpiresAt).toISOString(),
    password: 'operator-password',
    showPassword: true,
    usernameCheckMessage: 'Username is available',
  });
});

it('hydrates external defaults with local-time expiry formatting and gives account expiry priority over access end time', () => {
  const accountExpiresAt = '2026-09-10T17:04:00.000Z';
  const accessEndTime = '2026-09-11T01:02:00.000Z';

  const hydrated = hydrateAccountDraft(initialAccountDraftState, {
    ...externalRequest,
    accountExpiresAt,
    accessEndTime,
  }, new Date(2026, 8, 4, 8, 30));

  expect(hydrated.ldapUsername).toBe('taylorexample');
  expect(hydrated.vpnUsername).toBe('taylorexample');
  expect(hydrated.expirationDateTime).toBe(new Date(accountExpiresAt).toISOString());
});

it('hydrates an external access end time or injected same-day 23:59 default in the local timezone', () => {
  const accessEndTime = '2026-09-11T01:02:00.000Z';
  const now = new Date(2026, 8, 4, 8, 30);

  expect(hydrateAccountDraft(initialAccountDraftState, {
    ...externalRequest,
    accessEndTime,
  }, now).expirationDateTime).toBe(new Date(accessEndTime).toISOString());
  expect(hydrateAccountDraft(initialAccountDraftState, externalRequest, now).expirationDateTime).toBe('2026-09-04T23:59');
});

it('keeps internal VPN and expiry fields untouched while deriving the LDAP username from email', () => {
  const hydrated = accountDraftReducer({
    ...initialAccountDraftState,
    vpnUsername: 'existing-vpn',
    expirationDateTime: '2026-09-04T23:59',
    password: 'operator-password',
    showPassword: true,
    usernameCheckMessage: 'Username is available',
  }, {
    type: 'hydrated',
    request: {
      name: 'Taylor Example',
      email: 'taylor.example@cpp.edu',
      isInternal: true,
    },
    now: new Date(2026, 8, 4, 8, 30),
  });

  expect(hydrated).toMatchObject({
    ldapUsername: 'taylor.example',
    vpnUsername: 'existing-vpn',
    expirationDateTime: '2026-09-04T23:59',
    password: 'operator-password',
    showPassword: true,
    usernameCheckMessage: 'Username is available',
  });
});

it('clears only the availability result when an operator changes the LDAP username', () => {
  const changed = accountDraftReducer({
    ...initialAccountDraftState,
    ldapUsername: 'prior-name',
    vpnUsername: 'vpn-name',
    password: 'operator-password',
    usernameCheckMessage: 'Username is available',
    expirationDateTime: '2026-09-04T23:59',
    showPassword: true,
  }, { type: 'ldapUsernameChanged', value: 'new-name' });

  expect(changed).toEqual({
    ldapUsername: 'new-name',
    vpnUsername: 'vpn-name',
    password: 'operator-password',
    usernameCheckMessage: '',
    expirationDateTime: '2026-09-04T23:59',
    showPassword: true,
  });
});
