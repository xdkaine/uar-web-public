import { Client, Attribute, Change } from 'ldapts';
import { getRequiredEnv } from '../env-validator';
import { ldapLogger } from '../logger';
import { createLDAPClient } from './client';
import { searchLDAPUser } from './user-search';
import {
  withTimeout,
  sanitizeLdapError,
  escapeLDAPDN,
  formatRequestDescription,
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
  | 'tag_request'
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

/**
 * Create a new LDAP user account
 */
export async function createLDAPUser(
  username: string,
  email: string | null | undefined,
  fullName: string,
  isExternal: boolean,
  requestId?: string,
  expirationDate?: Date
): Promise<boolean> {
  let client: Client | null = null;
  let userDN: string | null = null;
  let createdUser = false;
  let stage: CreateLDAPUserStage = 'connect';
  void expirationDate;

  try {
    client = createLDAPClient();

    const bindDN = getRequiredEnv('LDAP_BIND_DN');
    const bindPassword = getRequiredEnv('LDAP_BIND_PASSWORD');
    const searchBase = getRequiredEnv('LDAP_SEARCH_BASE');
    const ldapDomain = getRequiredEnv('LDAP_DOMAIN');

    stage = 'bind';
    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const sanitizedUsername = escapeLDAPDN(username);
    userDN = `CN=${sanitizedUsername},${searchBase}`;

    const description = formatRequestDescription(requestId);

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

    // Tag account with Access Request ID if provided
    if (requestId) {
      try {
        stage = 'tag_request';
        const requestIdChange = new Change({
          operation: 'replace',
          modification: new Attribute({
            type: 'extensionAttribute15',
            values: [requestId]
          })
        });
        await withTimeout(client.modify(userDN, requestIdChange), LDAP_TIMEOUT);
        ldapLogger.info('Tagged new account with Access Request ID', { username, requestId });
      } catch (tagError) {
        ldapLogger.warn('Failed to tag new account with Access Request ID (proceeding anyway)', {
          username,
          requestId,
          error: sanitizeLdapError(tagError)
        });
      }
    }

    const groupDN = getRequiredEnv('LDAP_GROUP2ADD');
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
      const kaminoInternalGroup = getRequiredEnv('LDAP_KAMINO_INTERNAL_GROUP');
      const kaminoExternalGroup = getRequiredEnv('LDAP_KAMINO_EXTERNAL_GROUP');

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
export async function enableLDAPUser(username: string): Promise<boolean> {
  let client: Client | null = null;
  try {
    client = createLDAPClient();
    const bindDN = getRequiredEnv('LDAP_BIND_DN');
    const bindPassword = getRequiredEnv('LDAP_BIND_PASSWORD');

    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const userInfo = await searchLDAPUser(username);
    if (!userInfo) {
      const error = new Error(`LDAP user '${username}' not found in directory`);
      ldapLogger.warn('Attempted to enable non-existent LDAP user', { username });
      throw error;
    }

    const userDN = userInfo.objectName;

    ldapLogger.info('Enabling LDAP user', { username, dn: userDN });

    const change = new Change({
      operation: 'replace',
      modification: new Attribute({
        type: 'userAccountControl',
        values: ['512']
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
 * Sets userAccountControl to 514 (disabled account)
 */
export async function disableLDAPUser(username: string): Promise<boolean> {
  let client: Client | null = null;
  try {
    client = createLDAPClient();
    const bindDN = getRequiredEnv('LDAP_BIND_DN');
    const bindPassword = getRequiredEnv('LDAP_BIND_PASSWORD');

    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const userInfo = await searchLDAPUser(username);
    if (!userInfo) {
      const error = new Error(`LDAP user '${username}' not found in directory`);
      ldapLogger.warn('Attempted to disable non-existent LDAP user', { username });
      throw error;
    }

    const userDN = userInfo.objectName;

    ldapLogger.info('Disabling LDAP user', { username, dn: userDN });

    const change = new Change({
      operation: 'replace',
      modification: new Attribute({
        type: 'userAccountControl',
        values: ['514']
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
 * Delete an LDAP user account with safety checks
 * USE WITH EXTREME CAUTION
 */
export async function deleteLDAPUser(
  username: string,
  expectedRequestId?: string,
  skipSafetyChecks = false
): Promise<boolean> {
  let client: Client | null = null;
  try {
    client = createLDAPClient();
    const bindDN = getRequiredEnv('LDAP_BIND_DN');
    const bindPassword = getRequiredEnv('LDAP_BIND_PASSWORD');
    const searchBase = getRequiredEnv('LDAP_SEARCH_BASE');

    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const sanitizedUsername = escapeLDAPDN(username);
    const userDN = `CN=${sanitizedUsername},${searchBase}`;

    const userInfo = await searchLDAPUser(username);
    if (!userInfo) {
      ldapLogger.warn('LDAP user does not exist, skipping deletion', { username });
      return true;
    }

    // SAFETY CHECKS
    if (!skipSafetyChecks) {
      const description = userInfo.attributes.find((attr: { type: string }) => attr.type === 'description')?.values?.[0] || '';
      const userAccountControl = userInfo.attributes.find((attr: { type: string }) => attr.type === 'userAccountControl')?.values?.[0] || '';
      const whenCreated = userInfo.attributes.find((attr: { type: string }) => attr.type === 'whenCreated')?.values?.[0] || '';

      // Safety Check 1: Description must use the UAR tag format
      if (!descriptionMatchesRequestTag(description)) {
        ldapLogger.error('SAFETY CHECK FAILED: Account missing UAR description tag', { username, description });
        throw new Error(`Deletion blocked: Account "${username}" is missing the UAR Request ID tag.`);
      }

      // Safety Check 2: Verify request ID matches (if provided)
      if (expectedRequestId && !descriptionMatchesRequestTag(description, expectedRequestId)) {
        ldapLogger.error('SAFETY CHECK FAILED: Request ID mismatch', { username, expectedRequestId, description });
        throw new Error(`Deletion blocked: Account "${username}" does not belong to request ${expectedRequestId}.`);
      }

      // Safety Check 3: Account must be disabled
      const isEnabled = userAccountControl === '512' || userAccountControl === '66048';
      if (isEnabled) {
        ldapLogger.error('SAFETY CHECK FAILED: Account is enabled', { username, userAccountControl });
        throw new Error(`Deletion blocked: Account "${username}" is enabled.`);
      }

      // Safety Check 4: Account must be recent (created within last 7 days)
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
 * Rename an LDAP user account
 */
export async function renameLDAPUser(oldUsername: string, newUsername: string): Promise<boolean> {
  let client: Client | null = null;
  try {
    client = createLDAPClient();
    const bindDN = getRequiredEnv('LDAP_BIND_DN');
    const bindPassword = getRequiredEnv('LDAP_BIND_PASSWORD');
    const searchBase = getRequiredEnv('LDAP_SEARCH_BASE');
    const ldapDomain = getRequiredEnv('LDAP_DOMAIN');

    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const sanitizedOldUsername = escapeLDAPDN(oldUsername);
    const sanitizedNewUsername = escapeLDAPDN(newUsername);

    const oldDN = `CN=${sanitizedOldUsername},${searchBase}`;
    const newRDN = `CN=${sanitizedNewUsername}`;

    await withTimeout(client.modifyDN(oldDN, newRDN), LDAP_TIMEOUT);

    const newDN = `CN=${sanitizedNewUsername},${searchBase}`;

    const changes = [
      new Change({
        operation: 'replace',
        modification: new Attribute({
          type: 'sAMAccountName',
          values: [sanitizedNewUsername]
        })
      }),
      new Change({
        operation: 'replace',
        modification: new Attribute({
          type: 'userPrincipalName',
          values: [`${sanitizedNewUsername}@${ldapDomain}`]
        })
      }),
      new Change({
        operation: 'replace',
        modification: new Attribute({
          type: 'displayName',
          values: [sanitizedNewUsername]
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
