import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type { DirectoryGroup } from "./LifecycleGroupsWorkspace";

interface LifecycleGroupsWorkspaceRemovalDialogProps {
  group: DirectoryGroup | null;
  member: string | null;
  reason: string;
  mutating: boolean;
  canConfirm: boolean;
  requiresReview: boolean;
  onOpenChange: (open: boolean) => void;
  onReasonChange: (reason: string) => void;
  onConfirm: () => void;
}

export function LifecycleGroupsWorkspaceRemovalDialog({
  group,
  member,
  reason,
  mutating,
  canConfirm,
  requiresReview,
  onOpenChange,
  onReasonChange,
  onConfirm,
}: LifecycleGroupsWorkspaceRemovalDialogProps) {
  return (
    <AlertDialog open={Boolean(member)} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove {member} from {group?.name}?</AlertDialogTitle>
          <AlertDialogDescription>This creates and immediately processes a lifecycle action. If the directory outcome becomes uncertain, it will stop in reconciliation rather than replay automatically.</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="group-remove-reason">Reason for removing this account</Label>
          <Textarea id="group-remove-reason" value={reason} onChange={(event) => onReasonChange(event.target.value)} placeholder="Required evidence for the remove operation" autoFocus />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep member</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={mutating || !canConfirm || requiresReview}>Remove member</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
