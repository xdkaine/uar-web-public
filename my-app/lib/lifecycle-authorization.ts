import type { ActorAuthorization } from '@/lib/rbac/core';
import { actorHasPermission } from '@/lib/rbac/core';

type LifecycleAuthorizationTarget = {
  actionType: string;
  operationMode?: string | null;
};

const AD_ACTIONS = new Set([
  'disable_ad', 'enable_ad', 'delete_ad', 'disable_both', 'enable_both',
  'add_group_member', 'add_to_group', 'remove_from_group',
]);
const VPN_ACTIONS = new Set([
  'revoke_vpn', 'restore_vpn', 'delete_vpn_record', 'promote_vpn_role', 'demote_vpn_role',
  'disable_both', 'enable_both',
]);

export function actorCanOperateLifecycleAction(
  actor: ActorAuthorization,
  action: LifecycleAuthorizationTarget
): boolean {
  if (!actorHasPermission(actor, 'lifecycle.manage')) return false;
  if (AD_ACTIONS.has(action.actionType) && !actorHasPermission(actor, 'users.manage')) return false;
  if (action.actionType === 'delete_ad' && !actorHasPermission(actor, 'lifecycle.delete')) return false;
  if (action.actionType === 'delete_ad' && action.operationMode === 'directory_override' && !actorHasPermission(actor, 'lifecycle.delete_unmanaged')) return false;
  if (action.actionType === 'delete_vpn_record' && !actorHasPermission(actor, 'vpn.delete')) return false;
  if (VPN_ACTIONS.has(action.actionType) && !actorHasPermission(actor, 'vpn.manage')) return false;
  if (action.operationMode === 'directory_override' && !actorHasPermission(actor, 'lifecycle.override')) return false;
  return true;
}
