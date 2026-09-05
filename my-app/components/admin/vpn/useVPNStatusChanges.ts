import { useState } from "react";
import { fetchWithCsrf } from "@/lib/csrf";
import type { useToast } from "@/hooks/useToast";
import type { VPNAccount } from "./vpnManagementTypes";

interface VPNStatusChangesOptions {
  onRefresh: () => void;
  showToast: ReturnType<typeof useToast>["showToast"];
}

export function useVPNStatusChanges({
  onRefresh,
  showToast,
}: VPNStatusChangesOptions) {
  const [selectedAccount, setSelectedAccount] = useState<VPNAccount | null>(
    null,
  );
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [newStatus, setNewStatus] = useState("");
  const [statusReason, setStatusReason] = useState("");
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(
    new Set(),
  );
  const [showBulkEditModal, setShowBulkEditModal] = useState(false);
  const [bulkNewStatus, setBulkNewStatus] = useState("active");
  const [bulkReason, setBulkReason] = useState("");
  const [bulkFacultyApproval, setBulkFacultyApproval] = useState(true);

  const handleStatusChange = async () => {
    if (!selectedAccount || !newStatus) {
      showToast("Please select a status", "error");
      return;
    }

    try {
      const response = await fetchWithCsrf(
        `/api/admin/vpn-accounts/${selectedAccount.id}/status`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status: newStatus,
            reason: statusReason,
          }),
        },
      );

      if (!response.ok) {
        throw new Error("Failed to update status");
      }

      showToast("Account status updated successfully", "success");
      setShowStatusModal(false);
      setSelectedAccount(null);
      setNewStatus("");
      setStatusReason("");
      onRefresh();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : "Failed to update status",
        "error",
      );
    }
  };

  const handleBulkStatusChange = async () => {
    if (selectedAccountIds.size === 0) {
      showToast("Please select at least one account", "error");
      return;
    }

    if (!bulkNewStatus) {
      showToast("Please select a status", "error");
      return;
    }

    try {
      const response = await fetchWithCsrf(
        "/api/admin/vpn-accounts/bulk-status",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            accountIds: Array.from(selectedAccountIds),
            newStatus: bulkNewStatus,
            reason: bulkReason,
            createdByFaculty: bulkFacultyApproval,
          }),
        },
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to update statuses");
      }

      const result = await response.json();
      showToast(
        `Successfully updated ${result.updatedCount} account(s)${result.skippedCount > 0 ? ` (${result.skippedCount} skipped)` : ""}`,
        "success",
      );

      setShowBulkEditModal(false);
      setSelectedAccountIds(new Set());
      setBulkNewStatus("active");
      setBulkReason("");
      setBulkFacultyApproval(true);
      onRefresh();
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : "Failed to bulk update statuses",
        "error",
      );
    }
  };

  return {
    selectedAccount,
    setSelectedAccount,
    showStatusModal,
    setShowStatusModal,
    newStatus,
    setNewStatus,
    statusReason,
    setStatusReason,
    selectedAccountIds,
    setSelectedAccountIds,
    showBulkEditModal,
    setShowBulkEditModal,
    bulkNewStatus,
    setBulkNewStatus,
    bulkReason,
    setBulkReason,
    bulkFacultyApproval,
    setBulkFacultyApproval,
    handleStatusChange,
    handleBulkStatusChange,
  };
}
