import type { Dispatch, SetStateAction } from "react";
import { X } from "lucide-react";

import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import type {
  DirectoryPerson,
  MemberPickerAction,
  MemberPickerState,
} from "./lifecycleGroupSelection";
import { LifecycleGroupsWorkspacePersonInput } from "./LifecycleGroupsWorkspacePersonInput";
import { LifecycleGroupsWorkspaceAddButton } from "./LifecycleGroupsWorkspaceAddButton";
import { LifecycleGroupsWorkspaceSubmissionFeedback } from "./LifecycleGroupsWorkspaceSubmissionFeedback";

interface SubmissionIssue {
  operation: "add" | "remove";
  username: string;
  message: string;
  requiresReview: boolean;
}

interface LifecycleGroupsWorkspaceMemberPickerProps {
  picker: MemberPickerState;
  suggestions: DirectoryPerson[];
  suggestionsOpen: boolean;
  activeSuggestion: number;
  pickerDisabled: boolean;
  mutating: boolean;
  addReason: string;
  requiresReview: boolean;
  reviewUsernames: string[];
  submissionSummary: string;
  submissionIssue: SubmissionIssue | null;
  dispatchPicker: Dispatch<MemberPickerAction>;
  onActiveSuggestionChange: Dispatch<SetStateAction<number>>;
  onAddReasonChange: (reason: string) => void;
  onSubmit: () => void;
}

export function LifecycleGroupsWorkspaceMemberPicker({
  picker,
  suggestions,
  suggestionsOpen,
  activeSuggestion,
  pickerDisabled,
  mutating,
  addReason,
  requiresReview,
  reviewUsernames,
  submissionSummary,
  submissionIssue,
  dispatchPicker,
  onActiveSuggestionChange,
  onAddReasonChange,
  onSubmit,
}: LifecycleGroupsWorkspaceMemberPickerProps) {
  return (
    <>
      <div className="space-y-3">
        <Label htmlFor="group-user">Add accounts</Label>
        {picker.selectedPeople.length > 0 && (
          <ul aria-label="Selected accounts" className="flex flex-wrap gap-2">
            {picker.selectedPeople.map((person) => (
              <li key={person.username} className="inline-flex max-w-full items-center gap-2 rounded-md border bg-muted/50 py-1 pl-2.5 pr-1 text-sm">
                <span className="min-w-0 truncate" title={`${person.displayName} (${person.username})`}>
                  <span className="font-medium">{person.displayName}</span>
                  <span className="ml-1.5 text-xs text-muted-foreground">{person.username}</span>
                </span>
                <button type="button" disabled={mutating} aria-label={`Remove ${person.displayName} (${person.username}) from selection`} onClick={() => dispatchPicker({ type: "remove", username: person.username })} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50">
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <LifecycleGroupsWorkspacePersonInput
            picker={picker}
            suggestions={suggestions}
            suggestionsOpen={suggestionsOpen}
            activeSuggestion={activeSuggestion}
            disabled={pickerDisabled}
            dispatchPicker={dispatchPicker}
            onActiveSuggestionChange={onActiveSuggestionChange}
          />
          <LifecycleGroupsWorkspaceAddButton
            disabled={pickerDisabled || picker.selectedPeople.length === 0 || !addReason.trim() || requiresReview}
            mutating={mutating}
            count={picker.selectedPeople.length}
            onClick={onSubmit}
          />
        </div>
        <p id="group-user-help" className="text-xs text-muted-foreground">Select one or more accounts. The same reason will be recorded for each member; each change has its own lifecycle history.</p>
        {picker.open && !pickerDisabled && suggestions.length === 0 && <p role="status" className="text-sm text-muted-foreground">No matching accounts available to add.</p>}
      </div>
      <div className="space-y-2">
        <Label htmlFor="group-add-reason">Reason for adding accounts</Label>
        <Textarea id="group-add-reason" value={addReason} onChange={(event) => onAddReasonChange(event.target.value)} placeholder="Required reason for all selected accounts" disabled={pickerDisabled} />
      </div>
      <LifecycleGroupsWorkspaceSubmissionFeedback
        summary={submissionSummary}
        requiresReview={requiresReview}
        reviewUsernames={reviewUsernames}
        issue={submissionIssue}
      />
    </>
  );
}
