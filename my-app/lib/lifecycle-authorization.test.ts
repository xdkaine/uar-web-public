import { describe, expect, it } from 'vitest';
import type { ActorAuthorization } from '@/lib/rbac/core';
import type { PermissionKey } from '@/lib/rbac/permissions';
import { actorCanOperateLifecycleAction } from './lifecycle-authorization';

function actor(...permissions: PermissionKey[]): ActorAuthorization {
  return {
    username: 'operator1',
    roles: new Set(),
    permissions: new Set(permissions),
    viaLegacyAdminFallback: false,
  };
}

describe('lifecycle action authorization', () => {
  it('requires directory mutation privilege for AD and group actions', () => {
    expect(actorCanOperateLifecycleAction(actor('lifecycle.manage'), { actionType: 'disable_ad' })).toBe(false);
    expect(actorCanOperateLifecycleAction(actor('lifecycle.manage', 'users.manage'), { actionType: 'add_group_member' })).toBe(true);
  });

  it('requires VPN privilege for VPN actions and both privileges for combined actions', () => {
    expect(actorCanOperateLifecycleAction(actor('lifecycle.manage', 'vpn.manage'), { actionType: 'revoke_vpn' })).toBe(true);
    expect(actorCanOperateLifecycleAction(actor('lifecycle.manage', 'users.manage'), { actionType: 'disable_both' })).toBe(false);
    expect(actorCanOperateLifecycleAction(actor('lifecycle.manage', 'users.manage', 'vpn.manage'), { actionType: 'disable_both' })).toBe(true);
  });

  it('requires the explicit override privilege for directory exceptions', () => {
    const action = { actionType: 'enable_ad', operationMode: 'directory_override' };
    expect(actorCanOperateLifecycleAction(actor('lifecycle.manage', 'users.manage'), action)).toBe(false);
    expect(actorCanOperateLifecycleAction(actor('lifecycle.manage', 'users.manage', 'lifecycle.override'), action)).toBe(true);
  });

  it('requires the explicit deletion privilege for permanent AD deletion', () => {
    const action = { actionType: 'delete_ad' };
    expect(actorCanOperateLifecycleAction(actor('lifecycle.manage', 'users.manage'), action)).toBe(false);
    expect(actorCanOperateLifecycleAction(actor('lifecycle.manage', 'users.manage', 'lifecycle.delete'), action)).toBe(true);
  });

  it('requires the separate unmanaged-delete privilege for an unowned AD deletion', () => {
    const action = { actionType: 'delete_ad', operationMode: 'directory_override' };
    expect(actorCanOperateLifecycleAction(actor('lifecycle.manage', 'users.manage', 'lifecycle.delete', 'lifecycle.override'), action)).toBe(false);
    expect(actorCanOperateLifecycleAction(actor('lifecycle.manage', 'users.manage', 'lifecycle.delete', 'lifecycle.override', 'lifecycle.delete_unmanaged'), action)).toBe(true);
  });

  it('requires the separate VPN deletion privilege for permanent VPN record deletion', () => {
    const action = { actionType: 'delete_vpn_record' };
    expect(actorCanOperateLifecycleAction(actor('lifecycle.manage', 'vpn.manage'), action)).toBe(false);
    expect(actorCanOperateLifecycleAction(actor('lifecycle.manage', 'vpn.manage', 'vpn.delete'), action)).toBe(true);
  });
});
