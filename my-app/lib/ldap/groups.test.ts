import { describe, expect, it, vi } from 'vitest';

vi.mock('./utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./utils')>();
  return {
    ...actual,
    withTimeout: <T>(operation: Promise<T>) => operation,
  };
});

import { resolveLDAPGroupAncestorDNsFromClient, resolveLDAPGroupMembersFromClient } from './groups';

const ROOT_GROUP_DN = 'CN=Root,OU=Groups,DC=example,DC=test';
const NESTED_GROUP_DN = 'CN=Nested,OU=Groups,DC=example,DC=test';
const MEMBER_ONE_DN = 'CN=FixtureMemberOne,OU=Users,DC=example,DC=test';
const MEMBER_TWO_DN = 'CN=FixtureMemberTwo,OU=Users,DC=example,DC=test';

describe('resolveLDAPGroupMembersFromClient', () => {
  it('expands nested groups, avoids cycles, and deduplicates users by DN', async () => {
    const searches: Record<string, Record<string, unknown>> = {
      [`${ROOT_GROUP_DN}|member`]: {
        dn: ROOT_GROUP_DN,
        member: [
          MEMBER_ONE_DN,
          NESTED_GROUP_DN,
        ],
      },
      [`${MEMBER_ONE_DN}|objectClass`]: {
        dn: MEMBER_ONE_DN,
        objectClass: ['top', 'person', 'organizationalPerson', 'user'],
        sAMAccountName: 'member.one',
        displayName: 'Fixture Member One',
        mail: 'member.one@example.test',
        userAccountControl: '512',
        memberOf: [ROOT_GROUP_DN],
      },
      [`${NESTED_GROUP_DN}|objectClass`]: {
        dn: NESTED_GROUP_DN,
        objectClass: ['top', 'group'],
        cn: 'Nested',
      },
      [`${NESTED_GROUP_DN}|member`]: {
        dn: NESTED_GROUP_DN,
        member: [
          MEMBER_TWO_DN,
          MEMBER_ONE_DN,
          ROOT_GROUP_DN,
        ],
      },
      [`${MEMBER_TWO_DN}|objectClass`]: {
        dn: MEMBER_TWO_DN,
        objectClass: ['top', 'person', 'organizationalPerson', 'user'],
        sAMAccountName: 'member.two',
        cn: 'Fixture Member Two',
        mail: 'member.two@example.test',
        userAccountControl: '514',
      },
      [`${ROOT_GROUP_DN}|objectClass`]: {
        dn: ROOT_GROUP_DN,
        objectClass: ['top', 'group'],
        cn: 'Root',
      },
    };

    const client = {
      search: vi.fn(async (dn: string, options: { attributes?: string[] }) => {
        const attributeKey = options.attributes?.[0] === 'member' ? 'member' : 'objectClass';
        const entry = searches[`${dn}|${attributeKey}`];
        return {
          searchEntries: entry ? [entry as { dn: string } & Record<string, unknown>] : [],
          searchReferences: [] as string[],
        };
      }),
    } as unknown as Parameters<typeof resolveLDAPGroupMembersFromClient>[0];

    const members = await resolveLDAPGroupMembersFromClient(client, ROOT_GROUP_DN);

    expect(members.map((member) => member.username)).toEqual(['member.one', 'member.two']);
    expect(members[0]).toMatchObject({
      email: 'member.one@example.test',
      accountEnabled: true,
    });
    expect(members[1]).toMatchObject({
      email: 'member.two@example.test',
      accountEnabled: false,
    });
    expect(client.search).toHaveBeenCalledWith(NESTED_GROUP_DN, expect.objectContaining({ attributes: ['member'] }));
  });
});

describe('resolveLDAPGroupAncestorDNsFromClient', () => {
  it('walks transitive parents and terminates safely on cycles', async () => {
    const protectedParentDN = 'CN=Domain Admins,CN=Users,DC=example,DC=test';
    const client = {
      search: vi.fn(async (dn: string) => ({
        searchEntries: [{
          dn,
          objectClass: ['top', 'group'],
          memberOf: dn === ROOT_GROUP_DN
            ? [NESTED_GROUP_DN]
            : dn === NESTED_GROUP_DN
              ? [protectedParentDN]
              : [ROOT_GROUP_DN],
        }],
        searchReferences: [] as string[],
      })),
    } as unknown as Parameters<typeof resolveLDAPGroupAncestorDNsFromClient>[0];

    await expect(resolveLDAPGroupAncestorDNsFromClient(client, ROOT_GROUP_DN)).resolves.toEqual([
      NESTED_GROUP_DN,
      protectedParentDN,
    ]);
    expect(client.search).toHaveBeenCalledTimes(3);
  });

  it('fails closed when a parent group cannot be resolved', async () => {
    const client = {
      search: vi.fn(async (dn: string) => ({
        searchEntries: dn === ROOT_GROUP_DN
          ? [{ dn, objectClass: ['group'], memberOf: [NESTED_GROUP_DN] }]
          : [],
        searchReferences: [] as string[],
      })),
    } as unknown as Parameters<typeof resolveLDAPGroupAncestorDNsFromClient>[0];

    await expect(resolveLDAPGroupAncestorDNsFromClient(client, ROOT_GROUP_DN))
      .rejects.toThrow('not uniquely resolvable');
  });
});
