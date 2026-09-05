import Link from "next/link";

import { ClientLocalDate } from "./ClientLocalDate";
import { ticketCategoryLabel } from "@/lib/support/ticket-categories";

export interface BatchAccount {
  id: string;
  name: string;
  email: string | null;
  username: string;
  accountSystemLabel: string;
  accountExpiresAt: string | null;
  isInternal: boolean;
  status: string;
  provisionedAt: string | null;
  errorMessage: string | null;
  completedAt: string | null;
  accessRequestId: string | null;
}
export interface BatchAuditLog {
  id: string;
  createdAt: string;
  action: string;
  details: string;
  performedBy: string;
  accountName?: string;
  success: boolean;
}
export interface BatchDetail {
  id: string;
  createdAt: string;
  createdBy: string;
  description?: string;
  totalAccounts: number;
  successfulAccounts: number;
  failedAccounts: number;
  status: string;
  completedAt?: string;
  linkedTicket?: {
    id: string;
    subject: string;
    status: string;
    category?: string;
    severity?: string;
  };
  accounts: BatchAccount[];
  auditLogs: BatchAuditLog[];
}

const STATUS_BADGE_CLASSES: Record<string, string> = {
  processing:
    "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200",
  completed:
    "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-200",
  failed: "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200",
  partial:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-200",
  skipped: "bg-muted text-foreground",
};
const ACTION_BADGE_CLASSES: Record<string, string> = {
  batch_created:
    "bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-200",
  batch_completed:
    "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-200",
  ldap_account_created:
    "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-200",
  ldap_account_failed:
    "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200",
  vpn_account_created:
    "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-200",
  vpn_account_failed:
    "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200",
  account_processing_failed:
    "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200",
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`px-3 py-1 rounded-full text-xs font-semibold ${STATUS_BADGE_CLASSES[status] || "bg-muted text-foreground"}`}
    >
      {status}
    </span>
  );
}

function ActionBadge({
  action,
  success,
}: {
  action: string;
  success: boolean;
}) {
  const className =
    ACTION_BADGE_CLASSES[action] ||
    (success
      ? "bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-200"
      : "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-200");
  return (
    <span className={`px-2 py-1 rounded text-xs font-semibold ${className}`}>
      {action.replace(/_/g, " ").toUpperCase()}
    </span>
  );
}

export function BatchSummary({ batch }: { batch: BatchDetail }) {
  return (
    <div className="bg-muted/50 rounded-xl p-8 border border-border shadow-sm">
      <h3 className="text-lg font-bold mb-6 text-foreground">Batch Summary</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SummaryField label="Batch ID">
          <div className="font-mono text-sm bg-card px-3 py-2 rounded border border-border">
            {batch.id}
          </div>
        </SummaryField>
        <SummaryField label="Created By">
          <div className="font-semibold text-base">{batch.createdBy}</div>
        </SummaryField>
        <SummaryField label="Created At">
          <ClientLocalDate value={batch.createdAt} />
        </SummaryField>
        <SummaryField label="Completed At">
          {batch.completedAt ? (
            <ClientLocalDate value={batch.completedAt} />
          ) : (
            "—"
          )}
        </SummaryField>
        <SummaryField label="Description" wide>
          <div className="text-base bg-card px-4 py-3 rounded border border-border">
            {batch.description || "—"}
          </div>
        </SummaryField>
        <SummaryField label="Status">
          <StatusBadge status={batch.status} />
        </SummaryField>
      </div>
      {batch.linkedTicket && (
        <div className="mt-6 pt-6 border-t border-border">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">
            Linked Support Ticket
          </div>
          <div className="bg-card p-5 rounded-lg border border-border shadow-sm">
            <div className="font-bold text-base mb-2">
              {batch.linkedTicket.subject}
            </div>
            <div className="text-sm text-muted-foreground mb-3">
              Ticket ID:{" "}
              <span className="font-mono">{batch.linkedTicket.id}</span>
            </div>
            <div className="flex flex-wrap gap-3 text-sm">
              <span className="bg-muted px-3 py-1 rounded-full">
                Status:{" "}
                <span className="font-semibold">
                  {batch.linkedTicket.status}
                </span>
              </span>
              {batch.linkedTicket.category && (
                <span className="bg-muted px-3 py-1 rounded-full">
                  Category:{" "}
                  <span className="font-semibold">
                    {ticketCategoryLabel(batch.linkedTicket.category)}
                  </span>
                </span>
              )}
              {batch.linkedTicket.severity && (
                <span className="bg-muted px-3 py-1 rounded-full">
                  Severity:{" "}
                  <span className="font-semibold">
                    {batch.linkedTicket.severity}
                  </span>
                </span>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="mt-6 pt-6 border-t border-border grid grid-cols-3 gap-6">
        <Metric label="Total Accounts" value={batch.totalAccounts} />
        <Metric
          label="Successful"
          value={batch.successfulAccounts}
          tone="green"
        />
        <Metric label="Failed" value={batch.failedAccounts} tone="red" />
      </div>
    </div>
  );
}

function SummaryField({
  label,
  children,
  wide = false,
}: {
  label: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "md:col-span-2" : ""}>
      <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
        {label}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "green" | "red";
}) {
  const className =
    tone === "green"
      ? "border-green-200 dark:border-green-900 text-green-600 dark:text-green-400"
      : tone === "red"
        ? "border-red-200 dark:border-red-900 text-red-600 dark:text-red-400"
        : "border-border text-foreground";
  return (
    <div className={`text-center bg-card rounded-lg p-4 border ${className}`}>
      <div className="text-3xl font-bold">{value}</div>
      <div className="text-sm text-muted-foreground mt-2 font-semibold">
        {label}
      </div>
    </div>
  );
}

export function BatchDetailTabs({
  activeTab,
  batch,
  onTabChange,
}: {
  activeTab: "accounts" | "audit";
  batch: BatchDetail;
  onTabChange: (tab: "accounts" | "audit") => void;
}) {
  return (
    <div className="border-b-2 border-border">
      <div className="flex gap-4">
        <button
          onClick={() => onTabChange("accounts")}
          className={`px-4 py-2 font-semibold transition-colors ${activeTab === "accounts" ? "border-b-2 border-foreground text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Accounts ({batch.accounts.length})
        </button>
        <button
          onClick={() => onTabChange("audit")}
          className={`px-4 py-2 font-semibold transition-colors ${activeTab === "audit" ? "border-b-2 border-foreground text-foreground" : "text-muted-foreground hover:text-foreground"}`}
        >
          Audit Trail ({batch.auditLogs.length})
        </button>
      </div>
    </div>
  );
}

export function BatchAccountsList({ accounts }: { accounts: BatchAccount[] }) {
  return (
    <div className="space-y-5 max-h-[600px] overflow-y-auto pr-2">
      {accounts.map((account) => (
        <div
          key={account.id}
          className="bg-card border border-border rounded-xl p-6 shadow-sm hover:shadow-md transition-shadow"
        >
          <div className="flex justify-between items-start mb-4">
            <div>
              <div className="font-bold text-xl text-foreground">
                {account.name}
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                {account.email}
              </div>
            </div>
            <StatusBadge status={account.status} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <AccountField label="Username">
              <div className="font-semibold font-mono text-base">
                {account.username || "Missing"}
              </div>
            </AccountField>
            {account.accessRequestId && (
              <AccountField label="Request ID">
                <Link
                  href={`/admin/requests/${account.accessRequestId}`}
                  className="font-mono text-xs text-primary hover:underline break-all"
                >
                  {account.accessRequestId}
                </Link>
              </AccountField>
            )}
            <AccountField label="Account system">
              <div className="font-semibold text-base">
                {account.accountSystemLabel}
              </div>
            </AccountField>
            <AccountField label="Account category">
              <div className="font-semibold text-base">
                {account.isInternal ? "Internal" : "External"}
              </div>
            </AccountField>
            {account.accountExpiresAt && (
              <AccountField label="Expiration Date">
                <div className="font-semibold text-base">
                  <ClientLocalDate value={account.accountExpiresAt} />
                </div>
              </AccountField>
            )}
            {account.provisionedAt && (
              <AccountField label="Provisioned">
                <div className="font-semibold text-base">
                  <ClientLocalDate value={account.provisionedAt} />
                </div>
              </AccountField>
            )}
          </div>
          {account.errorMessage && (
            <div className="mt-4 p-4 bg-red-50 dark:bg-red-950/40 border border-red-300 rounded-lg text-sm text-red-900">
              <div className="font-bold mb-2">Error Details</div>
              <div>{account.errorMessage}</div>
            </div>
          )}
          {account.completedAt && (
            <div className="mt-4 pt-4 border-t border-border text-sm text-muted-foreground">
              <span className="font-semibold">Completed:</span>{" "}
              <ClientLocalDate value={account.completedAt} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
function AccountField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-muted/50 px-4 py-3 rounded-lg border border-border">
      <div className="text-xs text-muted-foreground mb-1 font-semibold">
        {label}
      </div>
      {children}
    </div>
  );
}

export function BatchAuditList({ auditLogs }: { auditLogs: BatchAuditLog[] }) {
  return (
    <div className="space-y-4 max-h-[600px] overflow-y-auto pr-2">
      {auditLogs.map((log) => (
        <div
          key={log.id}
          className="bg-card border border-border rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow"
        >
          <div className="flex flex-col md:flex-row md:justify-between md:items-start gap-3 mb-4">
            <div className="flex items-center gap-3 flex-wrap">
              <ActionBadge action={log.action} success={log.success} />
              <span className="text-sm text-muted-foreground font-medium">
                <ClientLocalDate value={log.createdAt} />
              </span>
            </div>
            <div className="text-sm bg-muted px-3 py-1.5 rounded-full">
              <span className="text-muted-foreground">By:</span>{" "}
              <span className="font-semibold text-foreground">
                {log.performedBy}
              </span>
            </div>
          </div>
          {log.accountName && (
            <div className="mb-3 bg-muted/50 px-4 py-2 rounded-lg border border-border">
              <span className="text-xs text-muted-foreground font-semibold">
                Account:
              </span>{" "}
              <span className="font-mono font-semibold text-base">
                {log.accountName}
              </span>
            </div>
          )}
          <div className="text-sm text-foreground leading-relaxed">
            {log.details}
          </div>
        </div>
      ))}
    </div>
  );
}
