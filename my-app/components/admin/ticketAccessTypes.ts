export interface TicketAssignment {
  id: string;
  targetType: string;
  targetUsername: string | null;
  targetGroupDn: string | null;
  targetLabel: string;
  isActive: boolean;
  assignedBy: string;
  assignedAt: string;
}
export interface TicketAssignmentHistoryEntry {
  id: string;
  action: string;
  targetLabel: string;
  actorUsername: string;
  createdAt: string;
}
export type AssignmentSuggestion =
  | {
      targetType: "user";
      username: string;
      label: string;
      secondaryLabel: string;
    }
  | {
      targetType: "directory_group";
      dn: string;
      label: string;
      secondaryLabel: string;
    };
export function suggestionKey(suggestion: AssignmentSuggestion) {
  return suggestion.targetType === "user"
    ? `user:${suggestion.username.toLowerCase()}`
    : `group:${suggestion.dn.toLowerCase()}`;
}
export function assignmentKey(assignment: TicketAssignment) {
  return assignment.targetType === "user"
    ? `user:${assignment.targetUsername?.toLowerCase() ?? ""}`
    : `group:${assignment.targetGroupDn?.toLowerCase() ?? ""}`;
}
