"use client";

import { requestActionImpact } from "@/components/admin/actionImpactRequest";
import { useToast } from "@/hooks/useToast";
import { fetchWithCsrf } from "@/lib/csrf";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ACTIONABLE_STATUSES,
  type PasswordExpirationReport,
  type PasswordExpirationRow,
  type SortField,
  type StatusFilter,
} from "./passwordExpirationModel";

function createCsv(rows: PasswordExpirationRow[]) {
  const headers = [
    "Status",
    "Username",
    "Name",
    "Email",
    "Password Last Set",
    "Password Expires",
    "Days Remaining",
    "Days Overdue",
    "Eligible",
    "Last Notification",
    "Detail",
  ];
  return [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.status,
        row.username,
        row.displayName,
        row.email,
        row.passwordLastSet || "",
        row.passwordExpiresAt || "",
        row.daysRemaining ?? "",
        row.daysOverdue ?? "",
        row.eligibleForNotification ? "yes" : "no",
        row.lastNotificationAt || "",
        row.detail,
      ]
        .map((cell) => `"${String(cell).replace(/"/g, '""')}"`)
        .join(","),
    ),
  ].join("\n");
}

export function usePasswordExpirationReport() {
  const [report, setReport] = useState<PasswordExpirationReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>("needs_action");
  const [sortField, setSortField] = useState<SortField>("days");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [selectedUsernames, setSelectedUsernames] = useState<string[]>([]);
  const { toast, showToast, hideToast } = useToast();

  const fetchReport = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch("/api/admin/password-expiration");
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error || "Failed to fetch password expiration report",
        );
      setReport(data);
      setSelectedUsernames([]);
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Failed to fetch password expiration report",
        "error",
      );
    } finally {
      setIsLoading(false);
    }
  }, [showToast]);
  useEffect(() => {
    fetchReport();
  }, [fetchReport]);

  const filteredRows = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const rows: PasswordExpirationRow[] = [];
    for (const row of report?.rows || []) {
      const matchesQuery =
        !query ||
        [
          row.username,
          row.displayName,
          row.email,
          row.detail,
          row.skipReason || "",
        ].some((value) => value.toLowerCase().includes(query));
      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "needs_action" &&
          ACTIONABLE_STATUSES.includes(row.status)) ||
        row.status === statusFilter;
      if (matchesQuery && matchesStatus) rows.push(row);
    }
    return rows.sort((left, right) => {
      const [leftValue, rightValue] =
        sortField === "days"
          ? [
              left.daysOverdue !== null
                ? -left.daysOverdue
                : (left.daysRemaining ?? Number.MAX_SAFE_INTEGER),
              right.daysOverdue !== null
                ? -right.daysOverdue
                : (right.daysRemaining ?? Number.MAX_SAFE_INTEGER),
            ]
          : [
              String(left[sortField] || "").toLowerCase(),
              String(right[sortField] || "").toLowerCase(),
            ];
      return leftValue < rightValue
        ? sortDirection === "asc"
          ? -1
          : 1
        : leftValue > rightValue
          ? sortDirection === "asc"
            ? 1
            : -1
          : 0;
    });
  }, [report, searchQuery, statusFilter, sortField, sortDirection]);
  const selectedUsernamesSet = useMemo(
    () => new Set(selectedUsernames),
    [selectedUsernames],
  );
  const selectedEligibleRows = useMemo(
    () =>
      filteredRows.filter(
        (row) =>
          selectedUsernamesSet.has(row.username) && row.eligibleForNotification,
      ),
    [filteredRows, selectedUsernamesSet],
  );
  const eligibleVisibleCount = useMemo(
    () =>
      filteredRows.reduce(
        (count, row) => count + Number(row.eligibleForNotification),
        0,
      ),
    [filteredRows],
  );
  const toggleSort = (field: SortField) => {
    if (sortField === field)
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    else {
      setSortField(field);
      setSortDirection("asc");
    }
  };
  const toggleSelection = (username: string, selected: boolean) =>
    setSelectedUsernames((current) =>
      selected
        ? Array.from(new Set([...current, username]))
        : current.filter((value) => value !== username),
    );
  const toggleAllVisible = (selected: boolean) => {
    if (!selected) {
      setSelectedUsernames([]);
      return;
    }

    const eligibleUsernames: string[] = [];
    for (const row of filteredRows) {
      if (row.eligibleForNotification) eligibleUsernames.push(row.username);
    }
    setSelectedUsernames(eligibleUsernames);
  };
  const sendReminders = async (
    mode: "selected" | "process",
    options?: { usernames?: string[]; force?: boolean },
  ) => {
    setIsSending(true);
    try {
      const response = await fetchWithCsrf(
        mode === "process"
          ? "/api/admin/password-expiration/process"
          : "/api/admin/password-expiration/notify",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "selected"
              ? {
                  usernames:
                    options?.usernames ||
                    selectedEligibleRows.map((row) => row.username),
                  statuses: ACTIONABLE_STATUSES,
                  force: options?.force === true,
                }
              : {},
          ),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(
          data.error || "Failed to send password expiration reminders",
        );
      showToast(
        `Sent ${data.summary?.sent || 0}, skipped ${data.summary?.skipped || 0}, failed ${data.summary?.failed || 0}`,
        data.summary?.failed ? "warning" : "success",
      );
      await fetchReport();
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Failed to send password expiration reminders",
        "error",
      );
    } finally {
      setIsSending(false);
    }
  };
  const forceResendSelected = async () => {
    if (selectedEligibleRows.length === 0) return;
    const decision = await requestActionImpact({
      title: "Force password reminders",
      description: `Send reminders to ${selectedEligibleRows.length} selected user${selectedEligibleRows.length === 1 ? "" : "s"} while bypassing milestone deduplication.`,
      items: [
        { label: "Recipients", value: selectedEligibleRows.length },
        {
          label: "External effect",
          value: "Email delivery begins immediately",
          tone: "warning",
        },
      ],
      confirmLabel: "Force resend",
      destructive: true,
      evidence:
        "Each attempted reminder is recorded with sent, skipped, or failed evidence.",
    });
    if (decision.confirmed) void sendReminders("selected", { force: true });
  };
  const exportCsv = () => {
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([createCsv(filteredRows)], { type: "text/csv;charset=utf-8;" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `password_expiration_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };
  return {
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
  };
}
