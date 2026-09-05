export interface GroupRemovalControlInput {
  canManage: boolean;
  mutationAllowed: boolean;
  reason: string;
}

export function getGroupRemovalControl(input: GroupRemovalControlInput) {
  const canOpen = input.canManage && input.mutationAllowed;
  return {
    canOpen,
    canConfirm: canOpen && input.reason.trim().length > 0,
  };
}

export function unavailableGroupMembershipView<T>() {
  return {
    members: [] as T[],
    mutationState: null,
  };
}
