import { Client, Attribute, Change } from 'ldapts';
import { getRequiredEnv, getOptionalEnv } from '../env-validator';
import { ldapLogger } from '../logger';
import { createLDAPClient } from './client';
import { searchLDAPUser } from './user-search';
import { 
  withTimeout, 
  withRetry,
  escapeLDAPDN,
  sanitizeLdapError,
  validatePasswordForLDAP,
  LDAP_TIMEOUT 
} from './utils';

/**
 * Set password for a new LDAP user account
 */
export async function setLDAPUserPassword(
  username: string,
  password: string
): Promise<boolean> {
  return await withRetry(async () => {
    const url = getRequiredEnv('LDAP_URL');
    const bindDN = getRequiredEnv('LDAP_BIND_DN');
    const bindPassword = getRequiredEnv('LDAP_BIND_PASSWORD');
    const searchBase = getRequiredEnv('LDAP_SEARCH_BASE');
    const isLdaps = url.startsWith('ldaps://');

    if (!isLdaps) {
      try {
        ldapLogger.info('Attempting password change with STARTTLS (required for AD password changes)');
        const allowInvalidCerts = getOptionalEnv('LDAP_ALLOW_INVALID_CERTS', 'true') === 'true';
        const client = new Client({
          url,
          tlsOptions: {
            rejectUnauthorized: !allowInvalidCerts,
          },
        });

        await withTimeout(client.startTLS({
          rejectUnauthorized: !allowInvalidCerts,
        }), LDAP_TIMEOUT);

        ldapLogger.info('STARTTLS established, now binding');

        await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

        const sanitizedUsername = escapeLDAPDN(username);
        const userDN = `CN=${sanitizedUsername},${searchBase}`;

        ldapLogger.info('Changing password for user', { userDN });

        validatePasswordForLDAP(password);

        const newPassword = `"${password}"`;
        const passwordBuffer = Buffer.from(newPassword, 'utf16le');

        const change = new Change({
          operation: 'replace',
          modification: new Attribute({
            type: 'unicodePwd',
            values: [passwordBuffer]
          })
        });

        await withTimeout(client.modify(userDN, change), LDAP_TIMEOUT);
        await client.unbind();

        ldapLogger.info('Password changed successfully with STARTTLS');
        return true;
      } catch (error: unknown) {
        const err = error as { code?: number; message?: string };
        ldapLogger.error('STARTTLS password change failed', err);

        if (err.code === 53 || (err.message && err.message.includes('WILL_NOT_PERFORM'))) {
          ldapLogger.error('AD refuses to change password - connection may not be secure enough');
          throw new Error('Active Directory requires a secure connection (LDAPS) to change passwords.');
        }

        throw new Error(`Failed to change password: ${err.message || 'Unknown error'}`);
      }
    }

    try {
      ldapLogger.info('Attempting password change with LDAPS');
      const client = createLDAPClient();

      await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

      const sanitizedUsername = escapeLDAPDN(username);
      const userDN = `CN=${sanitizedUsername},${searchBase}`;

      ldapLogger.info('Changing password for user', { userDN });

      validatePasswordForLDAP(password);

      const newPassword = `"${password}"`;
      const passwordBuffer = Buffer.from(newPassword, 'utf16le');

      const change = new Change({
        operation: 'replace',
        modification: new Attribute({
          type: 'unicodePwd',
          values: [passwordBuffer]
        })
      });

      await withTimeout(client.modify(userDN, change), LDAP_TIMEOUT);
      await client.unbind();

      ldapLogger.info('Password changed successfully with LDAPS');
      return true;
    } catch (error: unknown) {
      const err = error as { code?: number; message?: string };
      ldapLogger.error('LDAPS password change failed', err);

      if (err.code === 53 || (err.message && err.message.includes('WILL_NOT_PERFORM'))) {
        throw new Error('Active Directory is refusing the password change. Please contact your administrator.');
      }

      throw new Error(`Failed to change password: ${err.message || 'Unknown error'}`);
    }
  }, 'setLDAPUserPassword');
}

/**
 * Change password for an existing LDAP user (password reset)
 */
export async function changeLDAPUserPassword(
  username: string,
  newPassword: string,
  userDN?: string
): Promise<boolean> {
  const url = process.env.LDAP_URL || 'ldap://localhost:389';
  const isLdaps = url.startsWith('ldaps://');

  const sanitizedUsername = escapeLDAPDN(username);

  const dn = userDN || `CN=${sanitizedUsername},${process.env.LDAP_SEARCH_BASE}`;

  ldapLogger.info('Changing password for user', { username, dn });

  validatePasswordForLDAP(newPassword);

  if (!isLdaps) {
    try {
      ldapLogger.info('Attempting password change with STARTTLS');
      const client = new Client({
        url,
        tlsOptions: {
          rejectUnauthorized: false,
        },
      });

      await withTimeout(client.startTLS({
        rejectUnauthorized: false,
      }), LDAP_TIMEOUT);

      ldapLogger.info('STARTTLS established, now binding');

      await withTimeout(client.bind(
        process.env.LDAP_BIND_DN || '',
        process.env.LDAP_BIND_PASSWORD || ''
      ), LDAP_TIMEOUT);

      const newPasswordFormatted = `"${newPassword}"`;
      const passwordBuffer = Buffer.from(newPasswordFormatted, 'utf16le');

      const change = new Change({
        operation: 'replace',
        modification: new Attribute({
          type: 'unicodePwd',
          values: [passwordBuffer]
        })
      });

      await withTimeout(client.modify(dn, change), LDAP_TIMEOUT);
      await client.unbind();

      ldapLogger.info('Password changed successfully with STARTTLS');
      return true;
    } catch (error: unknown) {
      const err = error as { code?: number; message?: string };
      ldapLogger.error('STARTTLS password change failed', err);

      if (err.code === 53 || (err.message && err.message.includes('WILL_NOT_PERFORM'))) {
        throw new Error('Active Directory requires a secure connection (LDAPS) to change passwords.');
      }

      throw new Error(`Failed to change password: ${err.message || 'Unknown error'}`);
    }
  }

  try {
    ldapLogger.info('Attempting password change with LDAPS');
    const client = new Client({
      url,
      tlsOptions: {
        rejectUnauthorized: false,
      },
    });

    await withTimeout(client.bind(
      process.env.LDAP_BIND_DN || '',
      process.env.LDAP_BIND_PASSWORD || ''
    ), LDAP_TIMEOUT);

    const newPasswordFormatted = `"${newPassword}"`;
    const passwordBuffer = Buffer.from(newPasswordFormatted, 'utf16le');

    const change = new Change({
      operation: 'replace',
      modification: new Attribute({
        type: 'unicodePwd',
        values: [passwordBuffer]
      })
    });

    await withTimeout(client.modify(dn, change), LDAP_TIMEOUT);
    await client.unbind();

    ldapLogger.info('Password changed successfully with LDAPS');
    return true;
  } catch (error: unknown) {
    const err = error as { code?: number; message?: string };
    ldapLogger.error('LDAPS password change failed', err);

    if (err.code === 53 || (err.message && err.message.includes('WILL_NOT_PERFORM'))) {
      throw new Error('Active Directory is refusing the password change. Please contact your administrator.');
    }

    throw new Error(`Failed to change password: ${err.message || 'Unknown error'}`);
  }
}

/**
 * Change password using the user's current password.
 */
export async function changeLDAPUserPasswordWithCurrentPassword(
  username: string,
  currentPassword: string,
  newPassword: string,
  userDN?: string | null
): Promise<boolean> {
  let client: Client | null = null;
  let stage: 'lookup' | 'bind' | 'modify' = 'lookup';

  try {
    if (!username || !currentPassword || !newPassword) {
      throw new Error('Username, current password, and new password are required');
    }

    validatePasswordForLDAP(currentPassword);
    validatePasswordForLDAP(newPassword);

    let dn = userDN || undefined;
    try {
      const userInfo = await searchLDAPUser(username);
      if (userInfo?.objectName) {
        dn = userInfo.objectName;
      }
    } catch (lookupError) {
      ldapLogger.warn('Unable to refresh user DN before self-service password change', {
        username,
        error: sanitizeLdapError(lookupError),
      });
    }

    if (!dn) {
      throw new Error('User not found in directory');
    }

    const url = getRequiredEnv('LDAP_URL');
    const ldapDomain = getRequiredEnv('LDAP_DOMAIN');
    const allowInvalidCerts = getOptionalEnv('LDAP_ALLOW_INVALID_CERTS', 'true') === 'true';
    const bindName = username.includes('@') ? username : `${username}@${ldapDomain}`;
    const isLdaps = url.startsWith('ldaps://');

    client = new Client({
      url,
      tlsOptions: {
        rejectUnauthorized: !allowInvalidCerts,
      },
    });

    if (!isLdaps) {
      await withTimeout(client.startTLS({
        rejectUnauthorized: !allowInvalidCerts,
      }), LDAP_TIMEOUT);
    }

    stage = 'bind';
    await withTimeout(client.bind(bindName, currentPassword), LDAP_TIMEOUT);

    const currentPasswordBuffer = Buffer.from(`"${currentPassword}"`, 'utf16le');
    const newPasswordBuffer = Buffer.from(`"${newPassword}"`, 'utf16le');
    const changes = [
      new Change({
        operation: 'delete',
        modification: new Attribute({
          type: 'unicodePwd',
          values: [currentPasswordBuffer]
        })
      }),
      new Change({
        operation: 'add',
        modification: new Attribute({
          type: 'unicodePwd',
          values: [newPasswordBuffer]
        })
      })
    ];

    stage = 'modify';
    await withTimeout(client.modify(dn, changes), LDAP_TIMEOUT);

    ldapLogger.info('Self-service password change completed successfully', { username });
    return true;
  } catch (error: unknown) {
    const err = error as { code?: number | string; message?: string };
    ldapLogger.error('Self-service password change failed', undefined, {
      username,
      stage,
      error: sanitizeLdapError(error),
    });

    const message = err.message || '';
    if (stage === 'bind' || message.includes('data 52e')) {
      throw new Error('Current password was not accepted by Active Directory.');
    }

    if (
      err.code === 19 ||
      err.code === 53 ||
      message.includes('WILL_NOT_PERFORM') ||
      message.includes('constraint violation')
    ) {
      throw new Error('Active Directory rejected the new password. It may not meet complexity requirements or may match a previous password.');
    }

    throw new Error(`Failed to change password: ${message || 'Unknown error'}`);
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch {
      }
    }
  }
}

/**
 * Clear AD's required-password-change marker after a service-account password set.
 */
export async function clearLDAPUserPasswordChangeRequired(
  username: string,
  userDN?: string | null
): Promise<boolean> {
  let client: Client | null = null;

  try {
    if (!username) {
      throw new Error('Username is required');
    }

    let dn = userDN || undefined;
    if (!dn) {
      const userInfo = await searchLDAPUser(username);
      dn = userInfo?.objectName;
    }

    if (!dn) {
      throw new Error('User not found in directory');
    }

    client = createLDAPClient();
    await withTimeout(client.bind(
      getRequiredEnv('LDAP_BIND_DN'),
      getRequiredEnv('LDAP_BIND_PASSWORD')
    ), LDAP_TIMEOUT);

    const change = new Change({
      operation: 'replace',
      modification: new Attribute({
        type: 'pwdLastSet',
        values: ['-1']
      })
    });

    await withTimeout(client.modify(dn, change), LDAP_TIMEOUT);
    ldapLogger.info('Cleared AD password-change-required marker', { username });
    return true;
  } catch (error) {
    ldapLogger.error('Failed to clear AD password-change-required marker', undefined, {
      username,
      error: sanitizeLdapError(error),
    });
    throw error;
  } finally {
    if (client) {
      try {
        await client.unbind();
      } catch {
      }
    }
  }
}
