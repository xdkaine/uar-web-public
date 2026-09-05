"use client";

import type { Dispatch, MutableRefObject, SetStateAction } from "react";

import {
  MAX_LIFECYCLE_SELECTION,
  type LifecycleActionAvailability,
  type OwnershipInventoryAccount,
} from "./lifecycleAccountsWorkspaceUtils";
import type { LifecycleActionDraftUpdate } from "./LifecycleAccountsWorkspaceController";

export function useLifecycleAccountsSelectionCommands(input: {
  setSelected: Dispatch<SetStateAction<Set<string>>>;
  dispatchActionDraft: Dispatch<LifecycleActionDraftUpdate>;
  executionKeys: MutableRefObject<Record<string, string>>;
  visibleAccounts: OwnershipInventoryAccount[];
  allVisibleSelected: boolean;
}) {
  const toggleAccount = (accountRef: string) => {
    input.setSelected((current) => {
      const next = new Set(current);
      if (next.has(accountRef)) next.delete(accountRef);
      else if (next.size < MAX_LIFECYCLE_SELECTION) next.add(accountRef);
      return next;
    });
    input.dispatchActionDraft({ type: "clear" });
  };
  const selectVisible = () => {
    input.setSelected((current) => {
      const next = new Set(current);
      for (const account of input.visibleAccounts) {
        if (input.allVisibleSelected) next.delete(account.accountRef);
        else if (next.size < MAX_LIFECYCLE_SELECTION) next.add(account.accountRef);
      }
      return next;
    });
    input.dispatchActionDraft({ type: "clear" });
  };
  const clearSelection = () => {
    input.setSelected(new Set());
    input.dispatchActionDraft({ type: "clear" });
    input.executionKeys.current = {};
  };
  const chooseAction = (option: LifecycleActionAvailability) => {
    if (option.available)
      input.dispatchActionDraft({ type: "choose", actionType: option.actionType });
  };
  return { toggleAccount, selectVisible, clearSelection, chooseAction };
}
