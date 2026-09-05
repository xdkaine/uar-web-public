export type PasswordExpirationStatus =
  | "valid"
  | "expiring_soon"
  | "expired"
  | "must_change"
  | "never_expires"
  | "unknown"
  | "skipped";
export interface PasswordExpirationRow {
  requestId: string | null;
  username: string;
  displayName: string;
  email: string;
  status: PasswordExpirationStatus;
  eligibleForNotification: boolean;
  skipReason: string | null;
  accountEnabled: boolean | null;
  passwordLastSet: string | null;
  passwordExpiresAt: string | null;
  daysRemaining: number | null;
  daysOverdue: number | null;
  reminderMilestone: number | "expired" | "must_change" | null;
  reminderKey: string | null;
  lastNotificationAt: string | null;
  lastNotificationStatus: string | null;
  policySource: string;
  detail: string;
}
export interface PasswordExpirationReport {
  generatedAt: string;
  policy: {
    warningDays: number;
    maxPasswordAgeDays: number | null;
    policySource: string;
    milestones: number[];
  };
  summary: Record<
    PasswordExpirationStatus | "total" | "eligibleForNotification",
    number
  >;
  rows: PasswordExpirationRow[];
  recentLogs?: Array<{
    id: string;
    createdAt: string;
    action: string;
    username: string;
    subjectUsername: string | null;
    subjectEmail: string | null;
    outcome: string | null;
    success: boolean;
    errorMessage: string | null;
  }>;
}
export type StatusFilter = PasswordExpirationStatus | "all" | "needs_action";
export type SortField =
  | "status"
  | "username"
  | "displayName"
  | "email"
  | "passwordLastSet"
  | "passwordExpiresAt"
  | "days";
export const ACTIONABLE_STATUSES: PasswordExpirationStatus[] = [
  "expiring_soon",
  "expired",
  "must_change",
];

export function formatStatus(status: PasswordExpirationStatus) {
  return status.replace(/_/g, " ");
}
export function dueText(row: PasswordExpirationRow) {
  if (row.status === "must_change") return "Required now";
  if (row.daysOverdue !== null)
    return `${row.daysOverdue} day${row.daysOverdue === 1 ? "" : "s"} overdue`;
  if (row.daysRemaining !== null)
    return `${row.daysRemaining} day${row.daysRemaining === 1 ? "" : "s"} left`;
  return "N/A";
}
export function policyMaxAgeText(report: PasswordExpirationReport | null) {
  if (!report) return "loading";
  if (report.policy.policySource === "ad_unavailable")
    return "AD policy unavailable";
  if (report.policy.maxPasswordAgeDays === null) return "non-expiring";
  return `${report.policy.maxPasswordAgeDays} day max age`;
}
export function policySourceText(source: string | undefined) {
  switch (source) {
    case "ad_domain_policy":
      return "Active Directory domain policy";
    case "ad_computed":
      return "Active Directory computed expiry";
    case "ad_unavailable":
      return "Active Directory policy unavailable";
    default:
      return "loading";
  }
}
export function statusBadgeClass(status: PasswordExpirationStatus) {
  switch (status) {
    case "expired":
    case "must_change":
      return "bg-red-100 text-red-800 border-red-200 hover:bg-red-100 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900 dark:hover:bg-red-950/40";
    case "expiring_soon":
      return "bg-amber-100 dark:bg-amber-950/60 text-amber-800 border-amber-200 dark:border-amber-900 hover:bg-amber-100 dark:bg-amber-950/60 dark:bg-yellow-950/40 dark:text-yellow-200 dark:border-yellow-900 dark:hover:bg-yellow-950/40";
    case "valid":
      return "bg-green-100 text-green-800 border-green-200 hover:bg-green-100 dark:bg-green-950/40 dark:text-green-200 dark:border-green-900 dark:hover:bg-green-950/40";
    case "never_expires":
    case "skipped":
      return "bg-muted text-muted-foreground border-border hover:bg-muted";
    default:
      return "bg-blue-100 text-blue-800 border-blue-200 hover:bg-blue-100 dark:bg-blue-950/40 dark:text-blue-200 dark:border-blue-900 dark:hover:bg-blue-950/40";
  }
}
