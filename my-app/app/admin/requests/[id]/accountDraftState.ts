import type { AccessRequest } from './RequestDetailTypes';

export interface AccountDraftState {
  ldapUsername: string;
  vpnUsername: string;
  password: string;
  usernameCheckMessage: string;
  expirationDateTime: string;
  showPassword: boolean;
}

export type AccountDraftRequest = Pick<
  AccessRequest,
  'name' | 'email' | 'isInternal' | 'ldapUsername' | 'vpnUsername' | 'accountExpiresAt' | 'accessEndTime'
>;

export const initialAccountDraftState: AccountDraftState = {
  ldapUsername: '',
  vpnUsername: '',
  password: '',
  usernameCheckMessage: '',
  expirationDateTime: '',
  showPassword: false,
};

export type AccountDraftAction =
  | { type: 'hydrated'; request: AccountDraftRequest; now: Date }
  | { type: 'ldapUsernameChanged'; value: string }
  | { type: 'vpnUsernameChanged'; value: string }
  | { type: 'passwordChanged'; value: string }
  | { type: 'passwordVisibilityToggled' }
  | { type: 'expirationDateTimeChanged'; value: string }
  | { type: 'usernameCheckMessageChanged'; value: string };

function formatLocalDateTime(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  const hours = String(value.getHours()).padStart(2, '0');
  const minutes = String(value.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function defaultExternalUsername(request: AccountDraftRequest) {
  return request.name.replace(/\s+/g, '').toLowerCase();
}

export function hydrateAccountDraft(
  state: AccountDraftState,
  request: AccountDraftRequest,
  now: Date,
): AccountDraftState {
  const ldapUsername = request.ldapUsername
    || (request.isInternal ? request.email.split('@')[0] : defaultExternalUsername(request));
  const vpnUsername = request.isInternal
    ? state.vpnUsername
    : request.vpnUsername || defaultExternalUsername(request);

  let expirationDateTime = state.expirationDateTime;
  if (request.accountExpiresAt) {
    expirationDateTime = new Date(request.accountExpiresAt).toISOString();
  } else if (!request.isInternal && request.accessEndTime) {
    expirationDateTime = new Date(request.accessEndTime).toISOString();
  } else if (!request.isInternal) {
    expirationDateTime = `${formatLocalDateTime(now).slice(0, 10)}T23:59`;
  }

  return {
    ...state,
    ldapUsername,
    vpnUsername,
    expirationDateTime,
  };
}

export function accountDraftReducer(state: AccountDraftState, action: AccountDraftAction): AccountDraftState {
  switch (action.type) {
    case 'hydrated':
      return hydrateAccountDraft(state, action.request, action.now);
    case 'ldapUsernameChanged':
      return { ...state, ldapUsername: action.value, usernameCheckMessage: '' };
    case 'vpnUsernameChanged':
      return { ...state, vpnUsername: action.value };
    case 'passwordChanged':
      return { ...state, password: action.value };
    case 'passwordVisibilityToggled':
      return { ...state, showPassword: !state.showPassword };
    case 'expirationDateTimeChanged':
      return { ...state, expirationDateTime: action.value };
    case 'usernameCheckMessageChanged':
      return { ...state, usernameCheckMessage: action.value };
  }
}
