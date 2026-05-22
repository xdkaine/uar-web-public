import { describe, expect, it, vi } from 'vitest';
import { findReusableOffboardedRequest, reusableOffboardedUsername } from './offboard-reenrollment';
import { INTERNAL_EMAIL_DOMAIN } from './validation';

function internalEmail(localPart: string): string {
  return `${localPart}${INTERNAL_EMAIL_DOMAIN}`;
}

function clientReturning(result: unknown) {
  return {
    accessRequest: {
      findFirst: vi.fn().mockResolvedValue(result),
    },
  };
}

describe('findReusableOffboardedRequest', () => {
  it('returns null without a username or email', async () => {
    const client = clientReturning({ id: 'should-not-query' });

    await expect(findReusableOffboardedRequest({ client })).resolves.toBeNull();
    expect(client.accessRequest.findFirst).not.toHaveBeenCalled();
  });

  it('searches offboarded requests by username across all reusable username fields', async () => {
    const result = { id: 'request-1' };
    const client = clientReturning(result);

    await expect(findReusableOffboardedRequest({ username: ' user1 ', client })).resolves.toBe(result);
    expect(client.accessRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'offboarded',
          OR: [
            { ldapUsername: { equals: 'user1', mode: 'insensitive' } },
            { linkedAdUsername: { equals: 'user1', mode: 'insensitive' } },
            { vpnUsername: { equals: 'user1', mode: 'insensitive' } },
            { linkedVpnUsername: { equals: 'user1', mode: 'insensitive' } },
          ],
        },
      })
    );
  });

  it('requires email and username to match when both are provided', async () => {
    const client = clientReturning({ id: 'request-2' });

    await findReusableOffboardedRequest({ username: 'user2', email: ' Fixture.User@Example.test ', client });
    expect(client.accessRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'offboarded',
          AND: [
            { email: { equals: 'Fixture.User@Example.test', mode: 'insensitive' } },
            {
              OR: [
                { ldapUsername: { equals: 'user2', mode: 'insensitive' } },
                { linkedAdUsername: { equals: 'user2', mode: 'insensitive' } },
                { vpnUsername: { equals: 'user2', mode: 'insensitive' } },
                { linkedVpnUsername: { equals: 'user2', mode: 'insensitive' } },
              ],
            },
          ],
        },
      })
    );
  });

  it('searches by email when username is absent', async () => {
    const client = clientReturning({ id: 'request-3' });

    await findReusableOffboardedRequest({ email: ' fixture.user@example.test ', client });
    expect(client.accessRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'offboarded',
          email: { equals: 'fixture.user@example.test', mode: 'insensitive' },
        },
      })
    );
  });
});

describe('reusableOffboardedUsername', () => {
  it('prefers stored LDAP and linked AD usernames before deriving from internal email', () => {
    expect(reusableOffboardedUsername({ ldapUsername: 'ldap1', linkedAdUsername: 'linked1' }, internalEmail('fixture.user'))).toBe(
      'ldap1'
    );
    expect(reusableOffboardedUsername({ linkedAdUsername: 'linked1' }, internalEmail('fixture.user'))).toBe('linked1');
    expect(reusableOffboardedUsername({}, internalEmail('Fixture.User'))).toBe('Fixture.User');
  });

  it('returns null when no reusable username can be found', () => {
    expect(reusableOffboardedUsername({}, 'fixture.user@example.test')).toBeNull();
    expect(reusableOffboardedUsername(null)).toBeNull();
  });
});