import { Client, Attribute, Change } from 'ldapts';
import { getConfigValue, getRequiredSecretValue } from '../config/resolver';
import { ldapLogger } from '../logger';
import { createLDAPClient } from './client';
import { searchLDAPUser } from './user-search';
import { 
  withTimeout, 
  sanitizeLdapError, 
  escapeLDAPDN,
  LDAP_TIMEOUT 
} from './utils';

/**
 * Update a single attribute for an LDAP user
 */
export async function updateUserAttribute(
  username: string,
  attributeName: string,
  attributeValue: string
): Promise<boolean> {
  let client: Client | null = null;
  try {
    if (!username || !attributeName || attributeValue === undefined) {
      throw new Error('Username, attribute name, and attribute value are required');
    }

    const userInfo = await searchLDAPUser(username);
    if (!userInfo || !userInfo.objectName) {
      throw new Error('User not found in directory');
    }

    const userDN = userInfo.objectName;
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = (await getRequiredSecretValue('ldap.bindPassword'));

    client = await createLDAPClient();

    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const change = new Change({
      operation: 'replace',
      modification: new Attribute({
        type: attributeName,
        values: [attributeValue]
      })
    });

    await withTimeout(client.modify(userDN, change), LDAP_TIMEOUT);

    ldapLogger.info('User attribute updated successfully', {
      username,
      attribute: attributeName,
    });

    return true;
  } catch (error) {
    ldapLogger.error('Error updating user attribute', {
      error: sanitizeLdapError(error),
      username,
      attribute: attributeName,
    });
    throw error;
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
 * Update multiple attributes for an LDAP user in a single operation
 */
export async function updateUserAttributes(
  username: string,
  attributes: Record<string, string>
): Promise<boolean> {
  let client: Client | null = null;
  try {
    if (!username || !attributes || Object.keys(attributes).length === 0) {
      throw new Error('Username and at least one attribute are required');
    }

    const userInfo = await searchLDAPUser(username);
    if (!userInfo || !userInfo.objectName) {
      throw new Error('User not found in directory');
    }

    const userDN = userInfo.objectName;
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = (await getRequiredSecretValue('ldap.bindPassword'));

    client = await createLDAPClient();

    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const changes = Object.entries(attributes).map(([attributeName, attributeValue]) =>
      new Change({
        operation: 'replace',
        modification: new Attribute({
          type: attributeName,
          values: [attributeValue]
        })
      })
    );

    await withTimeout(client.modify(userDN, changes), LDAP_TIMEOUT);

    ldapLogger.info('User attributes updated successfully', {
      username,
      attributes: Object.keys(attributes),
    });

    return true;
  } catch (error) {
    ldapLogger.error('Error updating user attributes', {
      error: sanitizeLdapError(error),
      username,
      attributes: Object.keys(attributes),
    });
    throw error;
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
 * Set account expiration date for an LDAP user
 */
export async function setLDAPUserExpiration(
  username: string,
  expirationDate: Date,
  verifiedUserDn?: string
): Promise<boolean> {
  let client: Client | null = null;
  try {
    client = await createLDAPClient();
    const bindDN = await getConfigValue<string>('ldap.bindDn');
    const bindPassword = (await getRequiredSecretValue('ldap.bindPassword'));
    const searchBase = await getConfigValue<string>('ldap.searchBase');

    await withTimeout(client.bind(bindDN, bindPassword), LDAP_TIMEOUT);

    const userDN = verifiedUserDn || `CN=${escapeLDAPDN(username)},${searchBase}`;

    const epoch = new Date('1601-01-01T00:00:00Z').getTime();
    const expirationTime = expirationDate.getTime();
    const fileTime = ((expirationTime - epoch) * 10000).toString();

    const change = new Change({
      operation: 'replace',
      modification: new Attribute({
        type: 'accountExpires',
        values: [fileTime]
      })
    });

    await withTimeout(client.modify(userDN, change), LDAP_TIMEOUT);
    return true;
  } catch (err) {
    ldapLogger.error('Error setting user expiration', err);
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
 * Append a note to the AD account description field
 */
export async function appendADDescription(
  username: string,
  note: string
): Promise<boolean> {
  try {
    const userInfo = await searchLDAPUser(username);
    if (!userInfo) {
      throw new Error(`User ${username} not found in directory`);
    }

    const descAttr = userInfo.attributes.find((attr: { type: string; values: string[] }) => attr.type === 'description');
    const currentDescription = descAttr?.values?.[0] || '';

    const timestamp = new Date().toISOString().split('T')[0];
    const newDescription = currentDescription
      ? `${currentDescription} | ${timestamp}: ${note}`
      : `${timestamp}: ${note}`;

    await updateUserAttribute(username, 'description', newDescription);

    ldapLogger.info('Appended note to AD description', { username, note });
    return true;
  } catch (error) {
    ldapLogger.error('Error appending AD description', { username, note, error });
    return false;
  }
}
