"use client";

import { ShieldAlert, Users } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useLifecycleGroupsWorkspace } from "./LifecycleGroupsWorkspaceController";
import { LifecycleGroupsWorkspaceMemberPicker } from "./LifecycleGroupsWorkspaceMemberPicker";
import { LifecycleGroupsWorkspaceDetails } from "./LifecycleGroupsWorkspaceDetails";
import { LifecycleGroupsWorkspaceMembersTable } from "./LifecycleGroupsWorkspaceMembersTable";
import { LifecycleGroupsWorkspaceRemovalDialog } from "./LifecycleGroupsWorkspaceRemovalDialog";
import { LifecycleGroupsWorkspaceSidebar } from "./LifecycleGroupsWorkspaceSidebar";

export interface DirectoryGroup {
  dn: string;
  name: string;
  description: string;
}
export interface GroupMember {
  dn: string;
  username: string;
  displayName: string;
}
export interface GroupMutationState {
  allowed: boolean;
  readOnly: boolean;
  protected: boolean;
  readOnlyReason: string | null;
  protectionReason: string | null;
}

interface LifecycleGroupsWorkspaceProps {
  permissions: ReadonlySet<string>;
  onOperationsChanged: () => void;
  active?: boolean;
}

export default function LifecycleGroupsWorkspace({
  permissions,
  onOperationsChanged,
  active = true,
}: LifecycleGroupsWorkspaceProps) {
  const workspace = useLifecycleGroupsWorkspace({
    permissions,
    onOperationsChanged,
    active,
  });

  if (!workspace.canRead) {
    return (
      <Alert variant="destructive">
        <ShieldAlert />
        <AlertTitle>Directory access required</AlertTitle>
        <AlertDescription>
          Group membership is available to operators with users.read. Changes also require users.manage and lifecycle.manage.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="grid min-h-[38rem] overflow-hidden rounded-xl border bg-card lg:grid-cols-[20rem_minmax(0,1fr)]">
      <LifecycleGroupsWorkspaceSidebar
        groups={workspace.filteredGroups}
        loading={workspace.loadingGroups}
        query={workspace.groupQuery}
        selectedGroup={workspace.selectedGroup}
        disabled={workspace.mutating}
        onQueryChange={workspace.setGroupQuery}
        onSelectGroup={(group) => void workspace.loadMembers(group)}
      />
      <section className="min-w-0">
        {!workspace.selectedGroup ? (
          <div className="flex h-full min-h-[32rem] flex-col items-center justify-center px-6 text-center text-muted-foreground">
            <div className="rounded-full border border-dashed p-4"><Users className="h-7 w-7" /></div>
            <p className="mt-4 font-medium text-foreground">Choose a group</p>
            <p className="mt-1 max-w-sm text-sm">Membership reads and writes stay in this workspace. Every change becomes a lifecycle operation with recovery history.</p>
          </div>
        ) : (
          <>
            <LifecycleGroupsWorkspaceDetails group={workspace.selectedGroup} memberCount={workspace.members.length} canManage={workspace.canManage} mutationState={workspace.mutationState}>
              <LifecycleGroupsWorkspaceMemberPicker
                picker={workspace.memberPicker}
                suggestions={workspace.suggestions}
                suggestionsOpen={workspace.suggestionsOpen}
                activeSuggestion={workspace.activeSuggestion}
                pickerDisabled={workspace.pickerDisabled}
                mutating={workspace.mutating}
                addReason={workspace.addReason}
                requiresReview={workspace.requiresReview}
                reviewUsernames={workspace.selectedReviewTargets.map((person) => person.username)}
                submissionSummary={workspace.submissionSummary}
                submissionIssue={workspace.submissionIssue}
                dispatchPicker={workspace.dispatchPicker}
                onActiveSuggestionChange={workspace.setActiveSuggestion}
                onAddReasonChange={workspace.setAddReason}
                onSubmit={() => void workspace.mutateMembers("add", workspace.memberPicker.selectedPeople.map((person) => person.username), workspace.addReason)}
              />
            </LifecycleGroupsWorkspaceDetails>
            <LifecycleGroupsWorkspaceMembersTable
              group={workspace.selectedGroup}
              members={workspace.members}
              loading={workspace.loadingMembers}
              mutating={workspace.mutating}
              canOpenRemoval={workspace.removalControl.canOpen}
              reviewRequiredTargets={workspace.reviewRequiredTargets}
              onRemove={(username) => { workspace.setRemoveReason(""); workspace.setMemberToRemove(username); }}
            />
          </>
        )}
      </section>
      <LifecycleGroupsWorkspaceRemovalDialog
        group={workspace.selectedGroup}
        member={workspace.memberToRemove}
        reason={workspace.removeReason}
        mutating={workspace.mutating}
        canConfirm={workspace.removalControl.canConfirm}
        requiresReview={workspace.removalRequiresReview}
        onOpenChange={(open) => { if (!open) workspace.setMemberToRemove(null); }}
        onReasonChange={workspace.setRemoveReason}
        onConfirm={() => {
          if (workspace.memberToRemove) void workspace.mutateMembers("remove", [workspace.memberToRemove], workspace.removeReason);
        }}
      />
    </div>
  );
}
