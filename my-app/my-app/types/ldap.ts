export interface LDAPUser {
  dn: string;
  username: string;
  displayName: string;
  email: string;
  description: string;
  accountEnabled: boolean;
  accountExpires: string | null;
  whenCreated: string;
  memberOf: string[];
  extensionAttribute15?: string;
  pwdLastSet?: string;
  lastLogon?: string;
}

export interface LDAPUserInfo {
  username: string;
  displayName: string;
  email: string;
  enabled: boolean;
  groups: string[];
}
export interface LDAPCreateUserData {
  username: string;
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  description?: string;
  expirationDate?: Date;
}

export interface LDAPOperationResult {
  success: boolean;
  message?: string;
  error?: string;
  dn?: string;
}

export interface LDAPSearchOptions {
  base?: string;
  filter: string;
  scope?: 'base' | 'one' | 'sub';
  attributes?: string[];
  sizeLimit?: number;
  timeLimit?: number;
}
export interface LDAPGroup {
  dn: string;
  cn: string;
  description?: string;
  members: string[];
}

export interface GroupMembershipChange {
  groupDn: string;
  userDn: string;
  action: 'add' | 'remove';
}
export enum LDAPErrorCode {
  INVALID_CREDENTIALS = 49,
  INSUFFICIENT_ACCESS = 50,
  OBJECT_NOT_FOUND = 32,
  ENTRY_ALREADY_EXISTS = 68,
  CONSTRAINT_VIOLATION = 19,
  SIZE_LIMIT_EXCEEDED = 4,
  TIMEOUT = 85,
}

export interface LDAPError {
  code: number;
  message: string;
  originalError?: Error;
}
export enum UserAccountControl {
  SCRIPT = 0x0001,
  ACCOUNTDISABLE = 0x0002,
  HOMEDIR_REQUIRED = 0x0008,
  LOCKOUT = 0x0010,
  PASSWD_NOTREQD = 0x0020,
  PASSWD_CANT_CHANGE = 0x0040,
  ENCRYPTED_TEXT_PASSWORD_ALLOWED = 0x0080,
  NORMAL_ACCOUNT = 0x0200,
  DONT_EXPIRE_PASSWD = 0x10000,
  PASSWORD_EXPIRED = 0x800000,
}

export const UAC_NORMAL_ENABLED = UserAccountControl.NORMAL_ACCOUNT;
export const UAC_NORMAL_DISABLED = UserAccountControl.NORMAL_ACCOUNT | UserAccountControl.ACCOUNTDISABLE;
