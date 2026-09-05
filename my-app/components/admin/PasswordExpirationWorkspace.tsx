"use client";

import Toast from "@/components/Toast";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
} from "lucide-react";
import { ClientLocalDate } from "./ClientLocalDate";
import { PasswordExpirationReportTable } from "./PasswordExpirationReportTable";
import {
  policyMaxAgeText,
  policySourceText,
  type PasswordExpirationReport,
  type StatusFilter,
} from "./passwordExpirationModel";
import type { usePasswordExpirationReport } from "./usePasswordExpirationReport";

type Props = ReturnType<typeof usePasswordExpirationReport>;

export function PasswordExpirationWorkspace({
  report,
  isLoading,
  isSending,
  searchQuery,
  setSearchQuery,
  statusFilter,
  setStatusFilter,
  selectedUsernamesSet,
  selectedEligibleRows,
  eligibleVisibleCount,
  filteredRows,
  toggleSort,
  toggleSelection,
  toggleAllVisible,
  sendReminders,
  forceResendSelected,
  exportCsv,
  fetchReport,
  toast,
  hideToast,
}: Props) {
  const summaryCards = getSummaryCards(report);
  return (
    <div className="space-y-5">
      <Toast {...toast} onClose={hideToast} />
      <PasswordExpirationHeader
        isLoading={isLoading}
        isSending={isSending}
        hasRows={filteredRows.length > 0}
        onRefresh={fetchReport}
        onExport={exportCsv}
        onProcess={() => void sendReminders("process")}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {summaryCards.map(({ label, value, icon: Icon, className }) => (
          <Card key={label} className={`border ${className}`}>
            <CardContent className="p-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide">
                  {label}
                </p>
                <p className="text-2xl font-bold tabular-nums">{value}</p>
              </div>
              <Icon className="h-5 w-5" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <CardTitle className="text-base">
              Policy: {policyMaxAgeText(report)},{" "}
              {report?.policy.warningDays || 14} day warning{" "}
              <span className="ml-2 text-xs font-normal text-muted-foreground">
                Source: {policySourceText(report?.policy.policySource)} ·
                Milestones: {report?.policy.milestones?.join(", ") || "N/A"}{" "}
                days
              </span>
            </CardTitle>
            <div className="text-xs text-muted-foreground">
              Last generated:{" "}
              {report ? <ClientLocalDate value={report.generatedAt} /> : "N/A"}
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <ReportControls
            searchQuery={searchQuery}
            statusFilter={statusFilter}
            isSending={isSending}
            selectedCount={selectedEligibleRows.length}
            onSearchChange={setSearchQuery}
            onStatusChange={setStatusFilter}
            onSend={() => void sendReminders("selected")}
            onForceResend={forceResendSelected}
          />
          <PasswordExpirationReportTable
            isLoading={isLoading}
            isSending={isSending}
            rows={filteredRows}
            selectedUsernamesSet={selectedUsernamesSet}
            selectedEligibleCount={selectedEligibleRows.length}
            eligibleVisibleCount={eligibleVisibleCount}
            onToggleSort={toggleSort}
            onToggleSelection={toggleSelection}
            onToggleAll={toggleAllVisible}
            onSend={(username) =>
              void sendReminders("selected", { usernames: [username] })
            }
          />
          <RecentLogs report={report} />
        </CardContent>
      </Card>
    </div>
  );
}

function PasswordExpirationHeader({
  isLoading,
  isSending,
  hasRows,
  onRefresh,
  onExport,
  onProcess,
}: {
  isLoading: boolean;
  isSending: boolean;
  hasRows: boolean;
  onRefresh: () => void;
  onExport: () => void;
  onProcess: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h2 className="text-2xl font-bold text-foreground">
          Password Expiration
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          Active Directory password age monitoring for approved portal-managed
          accounts.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          onClick={onRefresh}
          disabled={isLoading}
          className="gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
        <Button
          variant="outline"
          onClick={onExport}
          disabled={!hasRows}
          className="gap-2"
        >
          <Download className="h-4 w-4" />
          Export
        </Button>
        <Button
          variant="secondary"
          onClick={onProcess}
          disabled={isSending}
          className="gap-2"
          title="Process unsent password reminder milestones"
        >
          <Send className="h-4 w-4" />
          Run Reminder Scan
        </Button>
      </div>
    </div>
  );
}

function ReportControls({
  searchQuery,
  statusFilter,
  isSending,
  selectedCount,
  onSearchChange,
  onStatusChange,
  onSend,
  onForceResend,
}: {
  searchQuery: string;
  statusFilter: StatusFilter;
  isSending: boolean;
  selectedCount: number;
  onSearchChange: (value: string) => void;
  onStatusChange: (value: StatusFilter) => void;
  onSend: () => void;
  onForceResend: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
      <div className="relative flex-1">
        <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchQuery}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search username, name, email, or detail..."
          className="pl-9"
        />
      </div>
      <div className="w-full xl:w-56">
        <Select
          value={statusFilter}
          onValueChange={(value) => onStatusChange(value as StatusFilter)}
        >
          <SelectTrigger>
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="needs_action">Needs Action</SelectItem>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="expiring_soon">Expiring Soon</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="must_change">Must Change</SelectItem>
            <SelectItem value="valid">Valid</SelectItem>
            <SelectItem value="never_expires">Never Expires</SelectItem>
            <SelectItem value="unknown">Unknown</SelectItem>
            <SelectItem value="skipped">Skipped</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <Button
        onClick={onSend}
        disabled={isSending || selectedCount === 0}
        className="gap-2 bg-foreground hover:bg-foreground/90"
      >
        <Send className="h-4 w-4" />
        Send Selected ({selectedCount})
      </Button>
      <Button
        variant="outline"
        onClick={onForceResend}
        disabled={isSending || selectedCount === 0}
        className="gap-2 text-red-700 dark:text-red-200 border-red-200 dark:border-red-900 hover:bg-red-50 dark:bg-red-950/40 hover:text-red-800"
      >
        <AlertTriangle className="h-4 w-4" />
        Force Resend
      </Button>
    </div>
  );
}

function getSummaryCards(report: PasswordExpirationReport | null) {
  return [
    {
      label: "Needs Action",
      value:
        (report?.summary.expiring_soon || 0) +
        (report?.summary.expired || 0) +
        (report?.summary.must_change || 0),
      icon: ShieldAlert,
      className:
        "text-red-700 bg-red-50 border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900",
    },
    {
      label: "Expiring Soon",
      value: report?.summary.expiring_soon || 0,
      icon: Clock,
      className:
        "text-amber-700 dark:text-amber-200 bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 dark:bg-yellow-950/40 dark:text-yellow-200 dark:border-yellow-900",
    },
    {
      label: "Expired",
      value:
        (report?.summary.expired || 0) + (report?.summary.must_change || 0),
      icon: AlertTriangle,
      className:
        "text-red-700 bg-red-50 border-red-200 dark:bg-red-950/40 dark:text-red-200 dark:border-red-900",
    },
    {
      label: "Healthy",
      value: report?.summary.valid || 0,
      icon: CheckCircle2,
      className:
        "text-green-700 bg-green-50 border-green-200 dark:bg-green-950/40 dark:text-green-200 dark:border-green-900",
    },
  ];
}

function RecentLogs({ report }: { report: PasswordExpirationReport | null }) {
  if (!report?.recentLogs?.length) return null;
  return (
    <div className="border-t pt-4">
      <div className="text-sm font-semibold text-muted-foreground">
        Recent notification log
      </div>
      <div className="mt-2 grid gap-2">
        {report.recentLogs.slice(0, 5).map((log) => (
          <div
            key={log.id}
            className="flex flex-col gap-1 rounded-md border bg-muted/50 px-3 py-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
          >
            <span>
              <span className="font-semibold">
                {log.action.replace(/_/g, " ")}
              </span>
              {log.subjectUsername ? ` for ${log.subjectUsername}` : ""}
              {log.outcome ? ` (${log.outcome})` : ""}
            </span>
            <span className="text-muted-foreground">
              <ClientLocalDate value={log.createdAt} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
