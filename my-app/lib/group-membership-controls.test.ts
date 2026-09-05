import { describe, expect, it } from 'vitest';

import { getGroupRemovalControl, unavailableGroupMembershipView } from './group-membership-controls';

describe('group removal controls', () => {
  it('lets an authorized operator open removal before entering a reason', () => {
    expect(getGroupRemovalControl({
      canManage: true,
      mutationAllowed: true,
      reason: '',
    })).toEqual({ canOpen: true, canConfirm: false });
  });

  it('requires the reason only for the irreversible confirmation', () => {
    expect(getGroupRemovalControl({
      canManage: true,
      mutationAllowed: true,
      reason: 'Project access ended',
    })).toEqual({ canOpen: true, canConfirm: true });
  });

  it('keeps protected or read-only groups unavailable', () => {
    expect(getGroupRemovalControl({
      canManage: true,
      mutationAllowed: false,
      reason: 'Project access ended',
    })).toEqual({ canOpen: false, canConfirm: false });
  });

  it('drops stale members and mutation metadata when a group load starts or fails', () => {
    expect(unavailableGroupMembershipView<{ username: string }>()).toEqual({
      members: [],
      mutationState: null,
    });
  });
});
