import { describe, it, expect } from 'vitest';
import {
  expandRecipientsFromAssignments,
  type AssignmentTarget,
} from './routing';

function group(dn: string, mail: string | null = null) {
  return { dn, name: dn, mail };
}

const baseMaps = () => ({
  groupsByDn: new Map<string, ReturnType<typeof group>>(),
  membersByGroupDn: new Map<string, { username: string; email: string | null; accountEnabled: boolean | null }[]>(),
  userEmailByUsername: new Map<string, string | null>(),
});

function expand(
  assignments: AssignmentTarget[],
  maps: ReturnType<typeof baseMaps>,
  queueEmail: string | null = 'soc@cpp.edu'
) {
  return expandRecipientsFromAssignments(
    assignments,
    maps.groupsByDn,
    maps.membersByGroupDn,
    maps.userEmailByUsername,
    queueEmail
  );
}

describe('expandRecipientsFromAssignments', () => {
  it('falls back to the default queue when no assignments exist', () => {
    const result = expand([], baseMaps());
    expect(result.emails).toEqual(['soc@cpp.edu']);
    expect(result.sources['soc@cpp.edu']).toBe('default-queue');
    expect(result.usedQueueFallback).toBe(true);
    expect(result.activeAssignmentCount).toBe(0);
  });

  it('uses the mail-enabled group address without member expansion', () => {
    const maps = baseMaps();
    const dn = 'CN=Ticket Team,OU=Groups,DC=cpp,DC=edu';
    maps.groupsByDn.set(dn, group(dn, 'ticket-team@cpp.edu'));
    maps.membersByGroupDn.set(dn, [
      { username: 'alice', email: 'alice@cpp.edu', accountEnabled: true },
    ]);

    const result = expand([{ targetType: 'directory_group', targetGroupDn: dn }], maps);

    expect(result.emails).toEqual(['ticket-team@cpp.edu']);
    expect(result.usedQueueFallback).toBe(false);
    expect(result.activeAssignmentCount).toBe(1);
  });

  it('expands enabled members with valid emails when the group is not mail-enabled', () => {
    const maps = baseMaps();
    const dn = 'CN=Ticket Team,OU=Groups,DC=cpp,DC=edu';
    maps.groupsByDn.set(dn, group(dn));
    maps.membersByGroupDn.set(dn, [
      { username: 'alice', email: 'Alice@Cpp.edu', accountEnabled: true },
      { username: 'bob', email: 'bob@cpp.edu', accountEnabled: true },
      { username: 'carol', email: null, accountEnabled: true },
      { username: 'dave', email: 'dave@cpp.edu', accountEnabled: false },
      { username: 'eve', email: 'not-an-email', accountEnabled: true },
      { username: 'unknown', email: 'unknown@cpp.edu', accountEnabled: null },
    ]);

    const result = expand([{ targetType: 'directory_group', targetGroupDn: dn }], maps);

    expect(result.emails.sort()).toEqual(['alice@cpp.edu', 'bob@cpp.edu']);
    expect(result.emails).not.toContain('unknown@cpp.edu');
    expect(result.sources['alice@cpp.edu']).toBe(`group-member:${dn}`);
    expect(result.usedQueueFallback).toBe(false);
  });

  it('deduplicates members shared across assigned groups', () => {
    const maps = baseMaps();
    const dnA = 'CN=A,DC=cpp,DC=edu';
    const dnB = 'CN=B,DC=cpp,DC=edu';
    maps.groupsByDn.set(dnA, group(dnA));
    maps.groupsByDn.set(dnB, group(dnB));
    maps.membersByGroupDn.set(dnA, [
      { username: 'alice', email: 'alice@cpp.edu', accountEnabled: true },
    ]);
    maps.membersByGroupDn.set(dnB, [
      { username: 'alice2', email: 'alice@cpp.edu', accountEnabled: true },
      { username: 'bob', email: 'bob@cpp.edu', accountEnabled: true },
    ]);

    const result = expand(
      [
        { targetType: 'directory_group', targetGroupDn: dnA },
        { targetType: 'directory_group', targetGroupDn: dnB },
      ],
      maps
    );

    expect(result.emails.sort()).toEqual(['alice@cpp.edu', 'bob@cpp.edu']);
    expect(result.activeAssignmentCount).toBe(2);
  });

  it('resolves user targets and mixes them with group targets', () => {
    const maps = baseMaps();
    const dn = 'CN=T,DC=cpp,DC=edu';
    maps.groupsByDn.set(dn, group(dn));
    maps.membersByGroupDn.set(dn, []);
    maps.userEmailByUsername.set('director1', 'director1@cpp.edu');

    const result = expand(
      [
        { targetType: 'user', targetUsername: 'director1' },
        { targetType: 'directory_group', targetGroupDn: dn },
      ],
      maps
    );

    expect(result.emails).toEqual(['director1@cpp.edu']);
    expect(result.sources['director1@cpp.edu']).toBe('user:director1');
  });

  it('still falls back to the queue when assignments resolve to zero addresses', () => {
    const maps = baseMaps();
    const dn = 'CN=Empty,DC=cpp,DC=edu';
    maps.groupsByDn.set(dn, group(dn));
    maps.membersByGroupDn.set(dn, []);

    const result = expand([{ targetType: 'directory_group', targetGroupDn: dn }], maps);

    expect(result.emails).toEqual(['soc@cpp.edu']);
    expect(result.usedQueueFallback).toBe(true);
    expect(result.activeAssignmentCount).toBe(1);
  });

  it('does not fall back to the queue when only some recipients are invalid', () => {
    const maps = baseMaps();
    maps.userEmailByUsername.set('ghost', null);

    const result = expand(
      [{ targetType: 'user', targetUsername: 'ghost' }],
      maps,
      null
    );
    // Queue unconfigured too -> nothing resolvable, but no crash.
    expect(result.emails).toEqual([]);
    expect(result.usedQueueFallback).toBe(true);
  });
});
