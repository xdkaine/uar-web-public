"use client";

import { useEffect, useMemo, useReducer, useRef, useState } from "react";

import { useToast } from "@/hooks/useToast";
import { fetchWithCsrf } from "@/lib/csrf";
import {
  getGroupRemovalControl,
  unavailableGroupMembershipView,
} from "@/lib/group-membership-controls";
import {
  filterDirectoryPeople,
  initialMemberPickerState,
  memberPickerReducer,
  type DirectoryPerson,
} from "./lifecycleGroupSelection";
import type {
  DirectoryGroup,
  GroupMember,
  GroupMutationState,
} from "./LifecycleGroupsWorkspace";

interface UseLifecycleGroupsWorkspaceInput {
  permissions: ReadonlySet<string>;
  onOperationsChanged: () => void;
  active: boolean;
}

/**
 * Owns request sequencing and mutation recovery for the Groups workspace.
 * Rendering remains in focused sibling components, while this hook keeps one
 * authoritative lock/idempotency ledger for each user-initiated directory write.
 */
export function useLifecycleGroupsWorkspace({
  permissions,
  onOperationsChanged,
  active,
}: UseLifecycleGroupsWorkspaceInput) {
  const { showToast } = useToast();

  const [groups, setGroups] = useState<DirectoryGroup[]>([]);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [directoryPeople, setDirectoryPeople] = useState<DirectoryPerson[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<DirectoryGroup | null>(
    null,
  );
  const [groupQuery, setGroupQuery] = useState("");
  const [memberPicker, dispatchPicker] = useReducer(
    memberPickerReducer,
    initialMemberPickerState,
  );
  const [activeSuggestion, setActiveSuggestion] = useState(-1);
  const [submissionIssue, setSubmissionIssue] = useState<{
    operation: "add" | "remove";
    username: string;
    message: string;
    requiresReview: boolean;
  } | null>(null);
  const [reviewRequiredTargets, setReviewRequiredTargets] = useState<
    Record<string, string>
  >({});
  const [submissionSummary, setSubmissionSummary] = useState("");
  const [mutationState, setMutationState] = useState<GroupMutationState | null>(
    null,
  );
  const [addReason, setAddReason] = useState("");
  const [removeReason, setRemoveReason] = useState("");
  const [loadingGroups, setLoadingGroups] = useState(true);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [mutating, setMutating] = useState(false);
  const [memberToRemove, setMemberToRemove] = useState<string | null>(null);
  const mutationKeys = useRef<Record<string, string>>({});
  const mutationBusy = useRef(false);
  const directoryLoaded = useRef(false);
  const mounted = useRef(true);
  const memberLoadSequence = useRef(0);
  const selectedGroupRef = useRef<DirectoryGroup | null>(null);

  const canRead = permissions.has("users.read");
  const canManage =
    permissions.has("users.manage") && permissions.has("lifecycle.manage");

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!canRead || !active || directoryLoaded.current) return;
    directoryLoaded.current = true;
    let cancelled = false;
    const load = async () => {
      setLoadingGroups(true);
      try {
        const [groupsResponse, usersResponse] = await Promise.all([
          fetchWithCsrf("/api/admin/groups"),
          fetchWithCsrf("/api/admin/users"),
        ]);
        const [groupsData, usersData] = await Promise.all([
          groupsResponse.json(),
          usersResponse.json(),
        ]);
        if (!groupsResponse.ok)
          throw new Error(
            groupsData.error || "Unable to load directory groups",
          );
        if (cancelled) return;
        setGroups(Array.isArray(groupsData.groups) ? groupsData.groups : []);
        if (usersResponse.ok) {
          const people: DirectoryPerson[] = [];
          for (const user of usersData.users || []) {
            if (!user.dn) continue;
            people.push({
              username: user.username,
              displayName: user.displayName || user.username,
              email: user.email || "",
            });
          }
          setDirectoryPeople(people);
        }
      } catch (error) {
        if (!cancelled)
          showToast(
            error instanceof Error
              ? error.message
              : "Unable to load directory groups",
            "error",
          );
      } finally {
        if (cancelled) return;
        setLoadingGroups(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [active, canRead, showToast]);

  const loadMembers = async (group: DirectoryGroup, preserveDraft = false) => {
    if (mutationBusy.current && !preserveDraft) return;
    const unavailableView = unavailableGroupMembershipView<GroupMember>();
    const loadSequence = ++memberLoadSequence.current;
    selectedGroupRef.current = group;
    setSelectedGroup(group);
    setMembers(unavailableView.members);
    if (!preserveDraft) {
      dispatchPicker({ type: "reset" });
      setAddReason("");
      setSubmissionIssue(null);
      setSubmissionSummary("");
    }
    setMutationState(unavailableView.mutationState);
    setLoadingMembers(true);
    try {
      const response = await fetchWithCsrf(
        `/api/admin/groups/${encodeURIComponent(group.name)}/members?dn=${encodeURIComponent(group.dn)}`,
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Unable to load group membership");
      if (
        loadSequence !== memberLoadSequence.current ||
        data.group?.dn !== group.dn
      )
        return;
      setMembers(Array.isArray(data.members) ? data.members : []);
      setMutationState(data.mutation ?? null);
    } catch (error) {
      if (loadSequence === memberLoadSequence.current) {
        const failedView = unavailableGroupMembershipView<GroupMember>();
        setMembers(failedView.members);
        setMutationState(failedView.mutationState);
        showToast(
          error instanceof Error
            ? error.message
            : "Unable to load group membership",
          "error",
        );
      }
    } finally {
      if (loadSequence === memberLoadSequence.current) setLoadingMembers(false);
    }
  };

  const filteredGroups = useMemo(() => {
    const normalized = groupQuery.trim().toLowerCase();
    if (!normalized) return groups;
    return groups.filter((group) =>
      [group.name, group.description].some((value) =>
        value?.toLowerCase().includes(normalized),
      ),
    );
  }, [groupQuery, groups]);

  const suggestions = useMemo(
    () =>
      filterDirectoryPeople({
        directoryPeople,
        currentUsernames: members.map((member) => member.username),
        selectedPeople: memberPicker.selectedPeople,
        query: memberPicker.query,
      }),
    [directoryPeople, memberPicker.query, memberPicker.selectedPeople, members],
  );
  const pickerDisabled =
    !canManage || mutationState?.allowed !== true || mutating;
  const suggestionsOpen =
    memberPicker.open && !pickerDisabled && suggestions.length > 0;
  const selectedReviewTargets = memberPicker.selectedPeople.filter(
    (person) =>
      selectedGroup &&
      reviewRequiredTargets[
        `add:${selectedGroup.dn}:${person.username.toLowerCase()}`
      ],
  );
  const requiresReview = selectedReviewTargets.length > 0;

  const mutateMembers = async (
    operation: "add" | "remove",
    usernames: string[],
    mutationReason: string,
  ) => {
    if (
      !selectedGroup ||
      !canManage ||
      mutationState?.allowed !== true ||
      !mutationReason.trim() ||
      mutationBusy.current ||
      usernames.length === 0 ||
      (operation === "add" && requiresReview)
    )
      return;
    const group = selectedGroup;
    const reason = mutationReason.trim();
    if (
      usernames.some(
        (username) =>
          reviewRequiredTargets[
            `${operation}:${group.dn}:${username.toLowerCase()}`
          ],
      )
    )
      return;
    mutationBusy.current = true;
    setMutating(true);
    dispatchPicker({ type: "close" });
    setSubmissionIssue(null);
    setSubmissionSummary("");
    let completed = 0;
    try {
      for (const username of usernames) {
        // Leaving the page stops unsent work, but does not cancel an in-flight directory outcome.
        if (!mounted.current) break;
        const planKey = `${operation}:${group.dn}:${username.toLowerCase()}:${reason}`;
        const idempotencyKey =
          mutationKeys.current[planKey] ?? crypto.randomUUID();
        mutationKeys.current[planKey] = idempotencyKey;
        let requiresOperationReview = true;
        try {
          const response = await fetchWithCsrf(
            `/api/admin/groups/${encodeURIComponent(group.name)}/members`,
            {
              method: operation === "add" ? "POST" : "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                username,
                groupDn: group.dn,
                reason,
                idempotencyKey,
              }),
            },
          );
          const data = await response.json();
          requiresOperationReview =
            Boolean(data.actionId) || response.status >= 500;
          if (!response.ok || !data.success) {
            throw new Error(
              data.error ||
                data.result?.error ||
                "Group action requires review",
            );
          }
          completed += 1;
          delete mutationKeys.current[planKey];
          if (operation === "add") dispatchPicker({ type: "remove", username });
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Unable to confirm the group membership change";
          setSubmissionIssue({
            operation,
            username,
            message,
            requiresReview: requiresOperationReview,
          });
          if (requiresOperationReview) {
            const targetKey = `${operation}:${group.dn}:${username.toLowerCase()}`;
            setReviewRequiredTargets((current) => ({
              ...current,
              [targetKey]: message,
            }));
          }
          showToast(
            `${username}: ${message}. Remaining accounts were not submitted.`,
            "error",
          );
          break;
        }
      }
      if (completed > 0) {
        setSubmissionSummary(
          `${completed} of ${usernames.length} ${usernames.length === 1 ? "member" : "members"} ${operation === "add" ? "added to" : "removed from"} ${group.name}.`,
        );
        showToast(
          `${completed} ${completed === 1 ? "member" : "members"} ${operation === "add" ? "added to" : "removed from"} ${group.name}`,
          "success",
        );
      }
      if (completed === usernames.length) {
        if (operation === "add") setAddReason("");
        else {
          setMemberToRemove(null);
          setRemoveReason("");
        }
      }
    } finally {
      // Refresh even after an unknown response: the server may have recorded an action.
      onOperationsChanged();
      if (mounted.current && selectedGroupRef.current?.dn === group.dn)
        await loadMembers(group, true);
      mutationBusy.current = false;
      setMutating(false);
    }
  };

  const removalControl = getGroupRemovalControl({
    canManage,
    mutationAllowed: mutationState?.allowed === true,
    reason: removeReason,
  });
  const removalRequiresReview = Boolean(
    selectedGroup &&
    memberToRemove &&
    reviewRequiredTargets[
      `remove:${selectedGroup.dn}:${memberToRemove.toLowerCase()}`
    ],
  );
  return {
    addReason,
    activeSuggestion,
    canManage,
    canRead,
    directoryPeople,
    dispatchPicker,
    filteredGroups,
    groupQuery,
    groups,
    loadMembers,
    loadingGroups,
    loadingMembers,
    memberPicker,
    memberToRemove,
    members,
    mutateMembers,
    mutating,
    pickerDisabled,
    removalControl,
    removalRequiresReview,
    removeReason,
    requiresReview,
    reviewRequiredTargets,
    selectedGroup,
    selectedReviewTargets,
    setActiveSuggestion,
    setAddReason,
    setGroupQuery,
    setMemberToRemove,
    setRemoveReason,
    submissionIssue,
    submissionSummary,
    suggestions,
    suggestionsOpen,
    mutationState,
  };
}
