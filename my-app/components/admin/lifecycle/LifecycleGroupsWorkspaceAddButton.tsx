import { Loader2, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";

interface LifecycleGroupsWorkspaceAddButtonProps {
  disabled: boolean;
  mutating: boolean;
  count: number;
  onClick: () => void;
}

export function LifecycleGroupsWorkspaceAddButton({
  disabled,
  mutating,
  count,
  onClick,
}: LifecycleGroupsWorkspaceAddButtonProps) {
  const label = mutating
    ? "Applying changes…"
    : count === 0
      ? "Add members"
      : `Add ${count} ${count === 1 ? "member" : "members"}`;

  return (
    <Button disabled={disabled} onClick={onClick}>
      {mutating ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
      {label}
    </Button>
  );
}
