import {
  AndFilter,
  Attribute,
  Change,
  Client,
  EqualityFilter,
  ExtensibleFilter,
  Filter,
  NotFilter,
  OrFilter,
} from 'ldapts';
import type { LifecycleAccountProtectionAssertion } from '../lifecycle-protection';
import { getConfigValue, getRequiredSecretValue } from '../config/resolver';
import { ldapLogger } from '../logger';
import { createLDAPClient } from './client';
import { getLDAPDefaultNamingContext, searchLDAPUser } from './user-search';
import {
  withTimeout,
  sanitizeLdapError,
  escapeLDAPDN,
  formatRequestDescription,
  formatBatchDescription,
  descriptionMatchesRequestTag,
  LDAP_TIMEOUT,
  parseLDAPDate
} from './utils';

type CreateLDAPUserStage =
  | 'connect'
  | 'bind'
  | 'add_user'
  | 'set_initial_uac'
  | 'set_description'
  | 'add_default_group'
  | 'add_kamino_group';

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function wrapCreateLDAPUserError(error: unknown, stage: CreateLDAPUserStage): Error {
  const wrapped = new Error(`LDAP user creation failed during ${stage}: ${getErrorMessage(error)}`);
  const code = (error as { code?: unknown })?.code;
  if (code !== undefined) {
    (wrapped as { code?: unknown }).code = code;
  }
  return wrapped;
}

function isWillNotPerformError(error: unknown): boolean {
  const ldapError = error as { code?: number | string; message?: string };
  const message = ldapError.message || '';
  return ldapError.code === 53 || ldapError.code === '53' || message.includes('WILL_NOT_PERFORM');
}

function currentUserAccountControl(
  userInfo: NonNullable<Awaited<ReturnType<typeof searchLDAPUser>>>,
  username: string
): number {
  const rawValue = userInfo.attributes.find(
    (attribute) => attribute.type.toLowerCase() === 'useraccountcontrol'
  )?.values?.[0];
  if (!rawValue || !/^\d+$/.test(rawValue)) {
    throw new Error(`LDAP user '${username}' has an unreadable userAccountControl value`);
  }
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`LDAP user '${username}' has an invalid userAccountControl value`);
  }
  return value;
}

function ldapEntryValue(entry: Record<string, unknown>, attributeName: string): unknown {
  const key = Object.keys(entry).find((candidate) => candidate.toLowerCase() === attributeName.toLowerCase());
  if (!key) return undefined;
  const value = entry[key];
  return Array.isArray(value) ? value[0] : value;
}

function decodeSid(value: unknown): { authority: number; subAuthorities: number[]; bytes: Buffer } | null {
  const bytes = Buffer.isBuffer(value)
    ? value
    : value instanceof Uint8Array
      ? Buffer.from(value)
      : null;
  if (!bytes || bytes.length < 12) return null;
  const subAuthorityCount = bytes[1];
  if (bytes.length !== 8 + (subAuthorityCount * 4)) return null;
  let authority = 0;
  for (let index = 2; index < 8; index += 1) authority = (authority * 256) + bytes[index];
  const subAuthorities = Array.from({ length: subAuthorityCount }, (_, index) => (
    bytes.readUInt32LE(8 + (index * 4))
  ));
  return { authority, subAuthorities, bytes };
}

function encodeSid(authority: number, subAuthorities: number[]): Buffer {
  const bytes = Buffer.alloc(8 + (subAuthorities.length * 4));
  bytes[0] = 1;
  bytes[1] = subAuthorities.length;
  let remainingAuthority = authority;
  for (let index = 7; index >= 2; index -= 1) {
    bytes[index] = remainingAuthority & 0xff;
    remainingAuthority = Math.floor(remainingAuthority / 256);
  }
  subAuthorities.forEach((value, index) => bytes.writeUInt32LE(value, 8 + (index * 4)));
  return bytes;
}

function protectedGroupSid(rid: string, userSid: ReturnType<typeof decodeSid>): Buffer | null {
  const numericRid = Number(rid);
  if (!Number.isSafeInteger(numericRid) || numericRid < 0) return null;
  // BUILTIN aliases use S-1-5-32-<RID>; domain groups use the current
  // account's domain SID with the account RID replaced by the group RID.
  if (['544', '548', '549', '550', '551'].includes(rid)) return encodeSid(5, [32, numericRid]);
  if (!userSid || userSid.subAuthorities.length < 2) return null;
  return encodeSid(userSid.authority, [...userSid.subAuthorities.slice(0, -1), numericRid]);
}

function ldapIdentityValue(value: unknown): string {
  return value instanceof Uint8Array ? Buffer.from(value).toString('base64') : String(value ?? '');
}

function isNoSuchObjectError(error: unknown): boolean {
  const ldapError = error as { code?: number | string; message?: string };
  const message = ldapError.message || '';
  return ldapError.code === 32
    || ldapError.code === '32'
    || message.includes('NO_OBJECT')
    || message.toLowerCase().includes('no such object');
}

function objectGuidFilterValue(objectGuid: string): string {
  const bytes = Buffer.from(objectGuid, 'base64');
  if (bytes.length === 0 || bytes.toString('base64').replace(/=+$/u, '') !== objectGuid.replace(/=+$/u, '')) {
    throw new Error('Deletion blocked: Captured directory object identity is not valid binary GUID evidence.');
  }
  return Array.from(bytes, (byte) => `\\${byte.toString(16).padStart(2, '0')}`).join('');
}

function objectGuidTargetDn(objectGuid: string): string {
  const bytes = Buffer.from(objectGuid, 'base64');
  if (
    bytes.length !== 16
    || bytes.toString('base64').replace(/=+$/u, '') !== objectGuid.replace(/=+$/u, '')
  ) {
    throw new Error('Directory mutation blocked: Captured directory object identity is not valid binary GUID evidence.');
  }

  // objectGUID stores the first three GUID fields in little-endian order.
  // AD accepts this alternative DN form as the target of LDAP requests.
  const data1 = bytes.readUInt32LE(0).toString(16).padStart(8, '0');
  const data2 = bytes.readUInt16LE(4).toString(16).padStart(4, '0');
  const data3 = bytes.readUInt16LE(6).toString(16).padStart(4, '0');
  const data4 = bytes.subarray(8, 10).toString('hex');
  const data5 = bytes.subarray(10, 16).toString('hex');
  return `<GUID=${data1}-${data2}-${data3}-${data4}-${data5}>`;
}

function deletionTargetAbsent(username: string): Error {
  const error = new Error(`Deletion blocked: Account "${username}" was absent before deletion; reconcile its state instead.`);
  (error as Error & { code: string }).code = 'LDAP_DELETE_TARGET_ABSENT';
  return error;
}

/**
 * Create a new LDAP user account
 */
export async function createLDAPUser(
  username: string,
  email: string | null | undefined,
  fullName: string,
  isExternal: boolean,
  owner?: string | { type: 'batch'; id: string },
  expirationDate?: Date
): Promise<boolean> {
  let client: Client | null = null;
  let userDN: string | null = null;
  let createdUser = false;
  let stage: CreateLDAPUserStage = 'connect';
  void expirationDate;

  try {
    client = await createLDAPClient();

    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = (await getRequiredSecretValue('ldap.bindPassword'));
    const searchBase = await getConfigValue<string>('ldap.searchBase');
    const ldapDomain = await getConfigValue<string>('ldap.domain');

    stage = 'bind';
    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const sanitizedUsername = escapeLDAPDN(username);
    userDN = `CN=${sanitizedUsername},${searchBase}`;

    const description = typeof owner === 'object'
      ? formatBatchDescription(owner.id)
      : formatRequestDescription(owner);

    const entry: Record<string, string | string[]> = {
      cn: sanitizedUsername,
      sn: fullName.split(' ').pop() || fullName,
      givenName: fullName.split(' ')[0] || fullName,
      displayName: fullName,
      objectClass: ['user', 'organizationalPerson', 'person', 'top'],
      sAMAccountName: sanitizedUsername,
      userPrincipalName: `${sanitizedUsername}@${ldapDomain}`,
      userAccountControl: '514',
    };

    if (email) {
      entry.mail = email;
    }

    stage = 'add_user';
    try {
      await withTimeout(client.add(userDN, entry), LDAP_TIMEOUT);
      createdUser = true;
    } catch (addError) {
      if (!isWillNotPerformError(addError)) {
        throw addError;
      }

      ldapLogger.warn('AD refused user add with initial userAccountControl; retrying add without it', {
        username,
        error: sanitizeLdapError(addError),
      });

      const entryWithoutInitialUac = Object.fromEntries(
        Object.entries(entry).filter(([key]) => key !== 'userAccountControl')
      ) as Record<string, string | string[]>;

      await withTimeout(client.add(userDN, entryWithoutInitialUac), LDAP_TIMEOUT);
    createdUser = true;

      stage = 'set_initial_uac';
      const initialUacChange = new Change({
        operation: 'replace',
        modification: new Attribute({
          type: 'userAccountControl',
          values: ['514']
        })
      });
      await withTimeout(client.modify(userDN, initialUacChange), LDAP_TIMEOUT);
    }

    // Set description AFTER account creation
    try {
      stage = 'set_description';
      const descriptionChange = new Change({
        operation: 'replace',
        modification: new Attribute({
          type: 'description',
          values: [description]
        })
      });
      await withTimeout(client.modify(userDN, descriptionChange), LDAP_TIMEOUT);
      ldapLogger.info('Description set successfully for new account', { username, description });
    } catch (descError) {
      ldapLogger.warn('Failed to set description on new account (proceeding anyway)', {
        username,
        error: sanitizeLdapError(descError)
      });
    }

    const groupDN = await getConfigValue<string>('ldap.group2Add');
    const groupChange = new Change({
      operation: 'add',
      modification: new Attribute({
        type: 'member',
        values: [userDN]
      })
    });

    stage = 'add_default_group';
    await withTimeout(client.modify(groupDN, groupChange), LDAP_TIMEOUT);

    // Add to Kamino Groups (Internal vs External)
    try {
      stage = 'add_kamino_group';
      const kaminoInternalGroup = await getConfigValue<string>('ldap.kaminoInternalGroup');
      const kaminoExternalGroup = await getConfigValue<string>('ldap.kaminoExternalGroup');

      const targetKaminoGroup = isExternal ? kaminoExternalGroup : kaminoInternalGroup;
      const groupType = isExternal ? 'External' : 'Internal';

      const kaminoGroupChange = new Change({
        operation: 'add',
        modification: new Attribute({
          type: 'member',
          values: [userDN]
        })
      });

      await withTimeout(client.modify(targetKaminoGroup, kaminoGroupChange), LDAP_TIMEOUT);
      ldapLogger.info(`Added user to Kamino ${groupType} group`, { username, group: targetKaminoGroup });
    } catch (kaminoError) {
      ldapLogger.error('Failed to add user to Kamino group', {
        username,
        isExternal,
        error: sanitizeLdapError(kaminoError)
      });
    }

    return true;
  } catch (err) {
    ldapLogger.error('Error creating user', {
      username,
      stage,
      error: sanitizeLdapError(err),
    });

    if (createdUser && userDN && client) {
      try {
        await withTimeout(client.del(userDN), LDAP_TIMEOUT);
        ldapLogger.warn('Rolled back partially created LDAP user after create failure', {
          username,
          failedStage: stage,
        });
      } catch (cleanupError) {
        ldapLogger.error('Failed to roll back partially created LDAP user', {
          username,
          failedStage: stage,
          error: sanitizeLdapError(cleanupError),
        });
      }
    }

    throw wrapCreateLDAPUserError(err, stage);
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch (unbindErr) {
        ldapLogger.error('Error unbinding connection', unbindErr);
      }
    }
  }
}

/**
 * Enable an LDAP user account
 */
export async function enableLDAPUser(username: string, expectedDn?: string): Promise<boolean> {
  let client: Client | null = null;
  try {
    client = await createLDAPClient();
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = (await getRequiredSecretValue('ldap.bindPassword'));

    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const userInfo = await searchLDAPUser(username);
    if (!userInfo) {
      const error = new Error(`LDAP user '${username}' not found in directory`);
      ldapLogger.warn('Attempted to enable non-existent LDAP user', { username });
      throw error;
    }

    const userDN = userInfo.objectName;
    if (expectedDn && userDN.toLowerCase() !== expectedDn.toLowerCase()) {
      throw new Error(`LDAP user '${username}' no longer resolves to the confirmed directory object`);
    }
    const existingUserAccountControl = currentUserAccountControl(userInfo, username);
    const enabledUserAccountControl = existingUserAccountControl & ~0x2;

    ldapLogger.info('Enabling LDAP user', { username, dn: userDN });

    const change = new Change({
      operation: 'replace',
      modification: new Attribute({
        type: 'userAccountControl',
        values: [String(enabledUserAccountControl)]
      })
    });

    await withTimeout(client.modify(userDN, change), LDAP_TIMEOUT);

    ldapLogger.info('LDAP user enabled', { username });
    return true;
  } catch (err) {
    ldapLogger.error('Error enabling user', sanitizeLdapError(err));
    throw err;
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch (unbindErr) {
        ldapLogger.error('Error unbinding connection', unbindErr);
      }
    }
  }
}

/**
 * Disable an LDAP user account
 * Sets the disabled bit while preserving the account's other userAccountControl flags.
 */
export async function disableLDAPUser(username: string, expectedDn?: string): Promise<boolean> {
  let client: Client | null = null;
  try {
    client = await createLDAPClient();
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = (await getRequiredSecretValue('ldap.bindPassword'));

    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const userInfo = await searchLDAPUser(username);
    if (!userInfo) {
      const error = new Error(`LDAP user '${username}' not found in directory`);
      ldapLogger.warn('Attempted to disable non-existent LDAP user', { username });
      throw error;
    }

    const userDN = userInfo.objectName;
    if (expectedDn && userDN.toLowerCase() !== expectedDn.toLowerCase()) {
      throw new Error(`LDAP user '${username}' no longer resolves to the confirmed directory object`);
    }
    const existingUserAccountControl = currentUserAccountControl(userInfo, username);
    const disabledUserAccountControl = existingUserAccountControl | 0x2;

    ldapLogger.info('Disabling LDAP user', { username, dn: userDN });

    const change = new Change({
      operation: 'replace',
      modification: new Attribute({
        type: 'userAccountControl',
        values: [String(disabledUserAccountControl)]
      })
    });

    await withTimeout(client.modify(userDN, change), LDAP_TIMEOUT);

    ldapLogger.info('LDAP user disabled', { username });
    return true;
  } catch (err) {
    ldapLogger.error('Error disabling LDAP user', sanitizeLdapError(err));
    throw err;
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch (unbindErr) {
        ldapLogger.error('Error unbinding connection', unbindErr);
      }
    }
  }
}

/**
 * Disable the exact reviewed LDAP object. Active Directory does not support
 * the RFC assertion control, so the modify targets AD's immutable GUID-based
 * alternative DN after the reviewed DN, username, GUID, and state are checked.
 */
export async function disableConfirmedLDAPUser(
  username: string,
  expectedDirectoryIdentity: { dn: string; objectGuid: string }
): Promise<boolean> {
  let client: Client | null = null;
  try {
    client = await createLDAPClient();
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = await getRequiredSecretValue('ldap.bindPassword');

    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const userInfo = await searchLDAPUser(username);
    if (!userInfo) {
      throw new Error(`LDAP user '${username}' not found in directory`);
    }

    const actualDn = userInfo.objectName;
    const actualUsername = String(userInfo.attributes.find(
      attribute => attribute.type.toLowerCase() === 'samaccountname'
    )?.values?.[0] ?? '');
    const actualObjectGuid = ldapIdentityValue(userInfo.attributes.find(
      attribute => attribute.type.toLowerCase() === 'objectguid'
    )?.values?.[0]);
    const existingUserAccountControl = currentUserAccountControl(userInfo, username);
    if (
      actualDn.toLowerCase() !== expectedDirectoryIdentity.dn.toLowerCase()
      || actualUsername.toLowerCase() !== username.toLowerCase()
      || actualObjectGuid !== expectedDirectoryIdentity.objectGuid
    ) {
      throw new Error(`LDAP user '${username}' no longer matches the reviewed directory object`);
    }
    if ((existingUserAccountControl & 0x2) !== 0) {
      throw new Error(`LDAP user '${username}' is already disabled`);
    }

    const targetDn = objectGuidTargetDn(expectedDirectoryIdentity.objectGuid);
    const disabledUserAccountControl = existingUserAccountControl | 0x2;
    const change = new Change({
      operation: 'replace',
      modification: new Attribute({
        type: 'userAccountControl',
        values: [String(disabledUserAccountControl)],
      }),
    });

    ldapLogger.info('Disabling reviewed LDAP user', { username, dn: actualDn });
    await withTimeout(client.modify(targetDn, change), LDAP_TIMEOUT);
    ldapLogger.info('Reviewed LDAP user disabled', { username });
    return true;
  } catch (err) {
    ldapLogger.error('Error disabling reviewed LDAP user', sanitizeLdapError(err));
    throw err;
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch (unbindErr) {
        ldapLogger.error('Error unbinding connection', unbindErr);
      }
    }
  }
}

/**
 * Enable the exact reviewed LDAP object through AD's immutable GUID-based
 * alternative DN. A replacement object at the same username and ordinary DN
 * must not inherit a prior lifecycle authorization.
 */
export async function enableConfirmedLDAPUser(
  username: string,
  expectedDirectoryIdentity: { dn: string; objectGuid: string }
): Promise<boolean> {
  let client: Client | null = null;
  try {
    client = await createLDAPClient();
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = await getRequiredSecretValue('ldap.bindPassword');

    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const userInfo = await searchLDAPUser(username);
    if (!userInfo) {
      throw new Error(`LDAP user '${username}' not found in directory`);
    }

    const actualDn = userInfo.objectName;
    const actualUsername = String(userInfo.attributes.find(
      attribute => attribute.type.toLowerCase() === 'samaccountname'
    )?.values?.[0] ?? '');
    const actualObjectGuid = ldapIdentityValue(userInfo.attributes.find(
      attribute => attribute.type.toLowerCase() === 'objectguid'
    )?.values?.[0]);
    const existingUserAccountControl = currentUserAccountControl(userInfo, username);
    if (
      actualDn.toLowerCase() !== expectedDirectoryIdentity.dn.toLowerCase()
      || actualUsername.toLowerCase() !== username.toLowerCase()
      || actualObjectGuid !== expectedDirectoryIdentity.objectGuid
    ) {
      throw new Error(`LDAP user '${username}' no longer matches the reviewed directory object`);
    }
    if ((existingUserAccountControl & 0x2) === 0) {
      throw new Error(`LDAP user '${username}' is already enabled`);
    }

    const targetDn = objectGuidTargetDn(expectedDirectoryIdentity.objectGuid);
    const enabledUserAccountControl = existingUserAccountControl & ~0x2;
    const change = new Change({
      operation: 'replace',
      modification: new Attribute({
        type: 'userAccountControl',
        values: [String(enabledUserAccountControl)],
      }),
    });

    ldapLogger.info('Enabling reviewed LDAP user', { username, dn: actualDn });
    await withTimeout(client.modify(targetDn, change), LDAP_TIMEOUT);
    ldapLogger.info('Reviewed LDAP user enabled', { username });
    return true;
  } catch (err) {
    ldapLogger.error('Error enabling reviewed LDAP user', sanitizeLdapError(err));
    throw err;
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch (unbindErr) {
        ldapLogger.error('Error unbinding connection', unbindErr);
      }
    }
  }
}

/**
 * Delete an LDAP user account with safety checks
 * USE WITH EXTREME CAUTION
 */
export async function deleteLDAPUser(
  username: string,
  expectedRequestId?: string,
  skipSafetyChecks = false,
  expectedDirectoryIdentity?: { dn: string; objectGuid: string }
): Promise<boolean> {
  let client: Client | null = null;
  try {
    client = await createLDAPClient();
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = (await getRequiredSecretValue('ldap.bindPassword'));
    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const userInfo = await searchLDAPUser(username);
    if (!userInfo) {
      ldapLogger.warn('LDAP user does not exist, skipping deletion', { username });
      return true;
    }
    const userDN = userInfo.objectName;

    // SAFETY CHECKS
    if (!skipSafetyChecks) {
      const description = userInfo.attributes.find((attr: { type: string }) => attr.type === 'description')?.values?.[0] || '';
      const userAccountControl = userInfo.attributes.find((attr: { type: string }) => attr.type === 'userAccountControl')?.values?.[0] || '';
      const whenCreated = userInfo.attributes.find((attr: { type: string }) => attr.type === 'whenCreated')?.values?.[0] || '';

      if (expectedDirectoryIdentity) {
        const objectGuid = userInfo.attributes.find(
          (attr: { type: string }) => attr.type.toLowerCase() === 'objectguid'
        )?.values?.[0] || '';
        if (
          userDN.toLowerCase() !== expectedDirectoryIdentity.dn.toLowerCase()
          || objectGuid !== expectedDirectoryIdentity.objectGuid
        ) {
          ldapLogger.error('SAFETY CHECK FAILED: Directory identity mismatch', {
            username,
            expectedDn: expectedDirectoryIdentity.dn,
            actualDn: userDN,
          });
          throw new Error(`Deletion blocked: Account "${username}" no longer matches its captured directory identity.`);
        }
      } else {
        // Creation compensation for legacy callers uses the exact description
        // correlation. It is not portal ownership evidence.
        if (!descriptionMatchesRequestTag(description)) {
          ldapLogger.error('SAFETY CHECK FAILED: Account missing UAR description correlation', { username, description });
          throw new Error(`Deletion blocked: Account "${username}" is missing its UAR creation correlation.`);
        }

        if (expectedRequestId && !descriptionMatchesRequestTag(description, expectedRequestId)) {
          ldapLogger.error('SAFETY CHECK FAILED: Creation correlation mismatch', { username, expectedRequestId, description });
          throw new Error(`Deletion blocked: Account "${username}" does not match creation correlation ${expectedRequestId}.`);
        }
      }

      // Account must be disabled.
      const parsedUserAccountControl = Number.parseInt(userAccountControl, 10);
      if (!Number.isFinite(parsedUserAccountControl)) {
        ldapLogger.error('SAFETY CHECK FAILED: Account enabled state is unavailable', { username });
        throw new Error(`Deletion blocked: Account "${username}" has an unknown enabled state.`);
      }
      const isEnabled = (parsedUserAccountControl & 2) === 0;
      if (isEnabled) {
        ldapLogger.error('SAFETY CHECK FAILED: Account is enabled', { username, userAccountControl });
        throw new Error(`Deletion blocked: Account "${username}" is enabled.`);
      }

      // Account must be recent (created within last 7 days).
      if (whenCreated) {
        const parsedWhenCreated = parseLDAPDate(whenCreated);

        if (parsedWhenCreated) {
          const createdDate = new Date(parsedWhenCreated);
          const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

          if (createdDate < sevenDaysAgo) {
            ldapLogger.error('SAFETY CHECK FAILED: Account too old', { username, whenCreated: parsedWhenCreated });
            throw new Error(`Deletion blocked: Account "${username}" was created more than 7 days ago.`);
          }
        }
      }

      ldapLogger.info('All safety checks passed for deletion', { username, expectedRequestId });
    } else {
      ldapLogger.warn('SAFETY CHECKS SKIPPED - Emergency deletion mode', { username });
    }

    await withTimeout(client.del(userDN), LDAP_TIMEOUT);

    ldapLogger.info('LDAP user deleted successfully', { username, expectedRequestId, safetyChecksPerformed: !skipSafetyChecks });
    return true;
  } catch (err) {
    ldapLogger.error('Error deleting LDAP user', sanitizeLdapError(err));
    throw err;
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch (unbindErr) {
        ldapLogger.error('Error unbinding connection', unbindErr);
      }
    }
  }
}

/**
 * Permanently delete one lifecycle-confirmed AD account.
 *
 * Unlike deleteLDAPUser, this is not creation rollback: it has no age or
 * description-tag policy. It instead requires immutable directory identity,
 * a live disabled state, and proves the captured object GUID is absent after
 * the delete. The callback runs immediately before the irreversible LDAP call
 * so the lifecycle processor can distinguish preflight failures from uncertain
 * external outcomes.
 */
export async function deleteConfirmedDisabledLDAPUser(
  username: string,
  expectedDirectoryIdentity: { dn: string; objectGuid: string },
  onDeleteStart: () => Promise<void> | void,
  assertPreDeleteAllowed: (user: {
    objectName: string;
    attributes: Array<{ type: string; values: string[] }>;
  }) => Promise<LifecycleAccountProtectionAssertion | void>
): Promise<{ dn: string; objectGuid: string; username: string; userAccountControl: number }> {
  let client: Client | null = null;
  try {
    client = await createLDAPClient();
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = await getRequiredSecretValue('ldap.bindPassword');
    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);
    const domainSearchBase = await getLDAPDefaultNamingContext(client);

    let searchEntries: Record<string, unknown>[];
    try {
      const result = await withTimeout(client.search(expectedDirectoryIdentity.dn, {
        filter: '(objectClass=*)',
        scope: 'base',
        attributes: [
          'sAMAccountName', 'userAccountControl', 'objectGUID', 'memberOf',
          'objectSid', 'adminCount', 'primaryGroupID', 'isCriticalSystemObject',
        ],
        explicitBufferAttributes: ['objectSid', 'objectGUID'],
        sizeLimit: 1,
      }), LDAP_TIMEOUT);
      searchEntries = result.searchEntries as Record<string, unknown>[];
    } catch (error) {
      if (isNoSuchObjectError(error)) {
        throw deletionTargetAbsent(username);
      }
      throw error;
    }

    const entry = searchEntries[0];
    if (!entry) {
      throw deletionTargetAbsent(username);
    }
    const actualDn = String(entry.dn || expectedDirectoryIdentity.dn);
    const actualUsername = String(ldapEntryValue(entry, 'sAMAccountName') ?? '');
    const actualObjectGuid = ldapIdentityValue(ldapEntryValue(entry, 'objectGUID'));
    const rawUserAccountControl = String(ldapEntryValue(entry, 'userAccountControl') ?? '');
    const userAccountControl = /^\d+$/u.test(rawUserAccountControl) ? Number(rawUserAccountControl) : Number.NaN;

    if (
      actualDn.toLowerCase() !== expectedDirectoryIdentity.dn.toLowerCase()
      || actualUsername.toLowerCase() !== username.toLowerCase()
      || actualObjectGuid !== expectedDirectoryIdentity.objectGuid
    ) {
      throw new Error(`Deletion blocked: Account "${username}" no longer matches its captured directory identity.`);
    }
    if (!Number.isSafeInteger(userAccountControl)) {
      throw new Error(`Deletion blocked: Account "${username}" has an unknown enabled state.`);
    }
    if ((userAccountControl & 2) === 0) {
      throw new Error(`Deletion blocked: Account "${username}" is enabled.`);
    }

    const attributes = Object.entries(entry)
      .filter(([key]) => key.toLowerCase() !== 'dn')
      .map(([type, value]) => ({
        type,
        values: (Array.isArray(value) ? value : [value]).map(ldapIdentityValue),
      }));
    const protectionPolicy = await assertPreDeleteAllowed({ objectName: actualDn, attributes });

    let directoryProtectedGroupDns: string[] = [];
    if (protectionPolicy && protectionPolicy.protectedPrimaryGroupRids.length > 0) {
      const userSid = decodeSid(ldapEntryValue(entry, 'objectSid'));
      const protectedSids = protectionPolicy.protectedPrimaryGroupRids
        .map((rid) => ({ rid, sid: protectedGroupSid(rid, userSid) }))
        .filter((candidate): candidate is { rid: string; sid: Buffer } => Boolean(candidate.sid));
      const protectedGroups = await withTimeout(client.search(domainSearchBase, {
        // Active Directory exposes primaryGroupToken as a computed attribute
        // but rejects LDAP equality matching against it (WRONG_MATCH_OPER).
        // Match immutable binary objectSid values instead. The adminCount
        // branch still captures renamed/custom AdminSDHolder groups.
        filter: new AndFilter({ filters: [
          new EqualityFilter({ attribute: 'objectClass', value: 'group' }),
          new OrFilter({ filters: [
            new EqualityFilter({ attribute: 'adminCount', value: '1' }),
            ...protectedSids.map(({ sid }) => new EqualityFilter({ attribute: 'objectSid', value: sid })),
          ] }),
        ] }),
        scope: 'sub',
        attributes: ['distinguishedName', 'objectSid', 'adminCount'],
        // Built-in SIDs can be valid UTF-8 bytes. Preserve their binary form
        // instead of letting ldapts decode them as text and lose SID identity.
        explicitBufferAttributes: ['objectSid'],
      }), LDAP_TIMEOUT);
      for (const rid of protectionPolicy.protectedPrimaryGroupRids) {
        const matches = protectedGroups.searchEntries.filter(
          (group) => decodeSid(ldapEntryValue(group, 'objectSid'))?.subAuthorities.at(-1)?.toString() === rid
        );
        if (['512', '544'].includes(rid) && matches.length !== 1) {
          throw new Error(`Deletion blocked: Mandatory protected group RID ${rid} did not resolve exactly once.`);
        }
        if (matches.length > 1) {
          throw new Error(`Deletion blocked: Directory returned ambiguous protected group identity for RID ${rid}.`);
        }
      }
      directoryProtectedGroupDns = protectedGroups.searchEntries
        .map((group) => String(group.dn ?? ''))
        .filter(Boolean);
    }

    const objectGuidFilter = objectGuidFilterValue(expectedDirectoryIdentity.objectGuid);
    const protectionFilters: Filter[] = protectionPolicy ? [
      new NotFilter({ filter: new EqualityFilter({ attribute: 'adminCount', value: '1' }) }),
      new NotFilter({ filter: new EqualityFilter({ attribute: 'isCriticalSystemObject', value: 'TRUE' }) }),
      ...protectionPolicy.protectedPrimaryGroupRids.map((rid) => new NotFilter({
        filter: new EqualityFilter({ attribute: 'primaryGroupID', value: rid }),
      })),
      ...[...new Set([...protectionPolicy.protectedGroupDns, ...directoryProtectedGroupDns])].map(
        (groupDn) => new NotFilter({
          filter: new ExtensibleFilter({
            matchType: 'memberOf',
            rule: '1.2.840.113556.1.4.1941',
            value: groupDn,
          }),
        })
      ),
    ] : [];
    const deleteTarget = objectGuidTargetDn(expectedDirectoryIdentity.objectGuid);
    const finalPreflightFilter = new AndFilter({
      filters: [
        new EqualityFilter({ attribute: 'objectGUID', value: Buffer.from(expectedDirectoryIdentity.objectGuid, 'base64') }),
        new EqualityFilter({ attribute: 'sAMAccountName', value: actualUsername }),
        new EqualityFilter({ attribute: 'userAccountControl', value: rawUserAccountControl }),
        ...protectionFilters,
      ],
    });
    // AD does not implement RFC 4528 conditional Delete. Recheck the complete
    // predicate on this bound DC, then address Delete only by immutable GUID.
    // This is not atomic: an out-of-band AD administrator can change the same
    // object after this read. Portal-origin operations retain their DB fences.
    let finalEntries: Record<string, unknown>[];
    try {
      const finalRead = await withTimeout(client.search(deleteTarget, {
        filter: finalPreflightFilter,
        scope: 'base',
        attributes: ['sAMAccountName', 'userAccountControl', 'objectGUID'],
        explicitBufferAttributes: ['objectGUID'],
        sizeLimit: 1,
      }), LDAP_TIMEOUT);
      finalEntries = finalRead.searchEntries as Record<string, unknown>[];
    } catch (error) {
      if (isNoSuchObjectError(error)) throw deletionTargetAbsent(username);
      throw error;
    }
    const finalEntry = finalEntries[0];
    if (
      finalEntries.length !== 1
      || String(finalEntry?.dn ?? '').toLowerCase() !== expectedDirectoryIdentity.dn.toLowerCase()
      || String(ldapEntryValue(finalEntry, 'sAMAccountName') ?? '').toLowerCase() !== username.toLowerCase()
      || ldapIdentityValue(ldapEntryValue(finalEntry, 'objectGUID')) !== expectedDirectoryIdentity.objectGuid
      || String(ldapEntryValue(finalEntry, 'userAccountControl') ?? '') !== rawUserAccountControl
    ) {
      throw new Error(`Deletion blocked: Account "${username}" changed or failed final disabled-account protection checks. Review it again.`);
    }
    ldapLogger.warn('Permanently deleting confirmed disabled LDAP user', {
      username,
      dn: expectedDirectoryIdentity.dn,
    });
    await onDeleteStart();
    await withTimeout(client.del(deleteTarget), LDAP_TIMEOUT);

    const readback = await withTimeout(client.search(domainSearchBase, {
      filter: `(objectGUID=${objectGuidFilter})`,
      scope: 'sub',
      attributes: ['objectGUID'],
      sizeLimit: 1,
    }), LDAP_TIMEOUT);
    if (readback.searchEntries.length > 0) {
      throw new Error(`Directory readback still finds the deleted object GUID for account "${username}".`);
    }

    ldapLogger.info('Confirmed disabled LDAP user permanently deleted', { username });
    return {
      dn: expectedDirectoryIdentity.dn,
      objectGuid: expectedDirectoryIdentity.objectGuid,
      username: actualUsername,
      userAccountControl,
    };
  } catch (error) {
    ldapLogger.error('Error permanently deleting confirmed disabled LDAP user', sanitizeLdapError(error));
    throw error;
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch (unbindError) {
        ldapLogger.error('Error unbinding connection', unbindError);
      }
    }
  }
}

/**
 * Rename an LDAP user account
 */
export async function renameLDAPUser(
  oldUsername: string,
  newUsername: string,
  verifiedUserDn?: string
): Promise<boolean> {
  let client: Client | null = null;
  try {
    client = await createLDAPClient();
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = (await getRequiredSecretValue('ldap.bindPassword'));
    const searchBase = await getConfigValue<string>('ldap.searchBase');
    const ldapDomain = await getConfigValue<string>('ldap.domain');

    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const sanitizedNewUsername = escapeLDAPDN(newUsername);
    const oldDN = verifiedUserDn || `CN=${escapeLDAPDN(oldUsername)},${searchBase}`;
    const newRDN = `CN=${sanitizedNewUsername}`;

    await withTimeout(client.modifyDN(oldDN, newRDN), LDAP_TIMEOUT);

    let separator = -1;
    let escaped = false;
    for (let index = 0; index < oldDN.length; index += 1) {
      const character = oldDN[index];
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === ',') {
        separator = index;
        break;
      }
    }
    if (separator < 0) throw new Error('Verified LDAP DN has no parent component');
    const newDN = `${newRDN}${oldDN.slice(separator)}`;

    const changes = [
      new Change({
        operation: 'replace',
        modification: new Attribute({
          type: 'sAMAccountName',
          values: [newUsername]
        })
      }),
      new Change({
        operation: 'replace',
        modification: new Attribute({
          type: 'userPrincipalName',
          values: [`${newUsername}@${ldapDomain}`]
        })
      }),
      new Change({
        operation: 'replace',
        modification: new Attribute({
          type: 'displayName',
          values: [newUsername]
        })
      })
    ];

    await withTimeout(client.modify(newDN, changes), LDAP_TIMEOUT);
    return true;
  } catch (err) {
    ldapLogger.error('Error renaming user', err);
    throw err;
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch (unbindErr) {
        ldapLogger.error('Error unbinding connection', unbindErr);
      }
    }
  }
}
