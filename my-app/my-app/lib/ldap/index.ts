// Utilities
export {
  formatRequestDescription,
  descriptionMatchesRequestTag,
  sanitizeLdapError,
  withTimeout,
  withRetry,
  escapeLDAPFilter,
  escapeLDAPDN,
  validatePasswordForLDAP,
  LDAP_TIMEOUT,
  LDAP_MAX_RETRIES,
  LDAP_RETRY_DELAY,
  UAR_DESCRIPTION_PREFIX,
} from './utils';

// Client & Authentication
export {
  createLDAPClient,
  authenticateLDAP,
  isPasswordChangeRequiredAuthStatus,
} from './client';

// User Search
export {
  searchLDAPUser,
  searchLDAPUserForProvisioning,
  isUserDomainAdmin,
  getLDAPUserEmail,
  listUsersInOU,
  searchUserByEmail,
} from './user-search';

// User CRUD
export {
  createLDAPUser,
  enableLDAPUser,
  disableLDAPUser,
  deleteLDAPUser,
  renameLDAPUser,
} from './user-crud';

// Password Operations
export {
  setLDAPUserPassword,
  changeLDAPUserPassword,
  changeLDAPUserPasswordWithCurrentPassword,
  clearLDAPUserPasswordChangeRequired,
} from './password';

// Attribute Management
export {
  updateUserAttribute,
  updateUserAttributes,
  setLDAPUserExpiration,
  tagAccountWithAccessRequestId,
  getAccessRequestIdFromAccount,
  appendADDescription,
} from './attributes';

// Group Operations
export {
  searchLDAPGroups,
  getLDAPGroupMembers,
  addLDAPGroupMember,
  removeLDAPGroupMember,
} from './groups';
