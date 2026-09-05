"use client";

import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useToast } from "@/hooks/useToast";
import Toast from "@/components/Toast";
import { fetchWithCsrf } from "@/lib/csrf";
import { usePolling } from "@/hooks/usePolling";
import { useVPNImports } from "./vpn/useVPNImports";
import { useVPNStatusChanges } from "./vpn/useVPNStatusChanges";
import { exportVPNAccountsCsv } from "./vpn/exportVPNAccountsCsv";
import { VPNImportWorkspace } from "./vpn/VPNImportWorkspace";
import VPNAccountDetailModal from "./VPNAccountDetailModal";
import VPNBulkEditModal from "./vpn/VPNBulkEditModal";
import VPNStatusDialog from "./vpn/VPNStatusDialog";
import VPNManagementOverview from "./vpn/VPNManagementOverview";
import VPNManagementFilters from "./vpn/VPNManagementFilters";
import VPNManagementList from "./vpn/VPNManagementList";
import { useVPNAccountQuery } from "./vpn/useVPNAccountQuery";
import { getPortalBadge, getStatusBadge } from "./vpn/vpnBadgePresentation";
import type { VPNAccount } from "./vpn/vpnManagementTypes";

export type StatusFilter =
  "all" | "active" | "pending_faculty" | "disabled" | "revoked";
export type PortalFilter = "all" | "Management" | "Limited" | "External";
export type FacultyFilter = "all" | "approved" | "pending";

interface VPNManagementTabProps {
  accounts?: VPNAccount[];
  isLoading?: boolean;
}

export default function VPNManagementTab({
  accounts: initialAccounts,
  isLoading: initialLoading = true,
}: VPNManagementTabProps) {
  const [accounts, setAccounts] = useState<VPNAccount[]>(initialAccounts ?? []);
  const [isLoading, setIsLoading] = useState(initialLoading);

  useEffect(() => {
    if (initialAccounts !== undefined) {
      setAccounts(initialAccounts);
    }
  }, [initialAccounts]);

  useEffect(() => {
    setIsLoading(initialLoading);
  }, [initialLoading]);

  const fetchAccounts = useCallback(async () => {
    const response = await fetchWithCsrf("/api/admin/vpn-accounts");
    if (!response.ok) throw new Error("Failed to fetch VPN accounts");
    return await response.json();
  }, []);

  const { isPolling, togglePolling, refresh, lastUpdated } = usePolling(
    fetchAccounts,
    {
      onSuccess: (data) => {
        setAccounts(data.accounts || []);
        setIsLoading(false);
      },
      onError: (error) => {
        console.error("Error fetching VPN accounts:", error);
        setIsLoading(false);
      },
    },
  );

  const onRefresh = refresh;
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(
    null,
  );
  const query = useVPNAccountQuery(accounts);
  const {
    searchQuery,
    setSearchQuery,
    filterStatus,
    setFilterStatus,
    filterPortal,
    setFilterPortal,
    filterFaculty,
    setFilterFaculty,
    setCurrentPage,
    sortField,
    sortDirection,
    showAdvancedFilters,
    setShowAdvancedFilters,
    viewMode,
    setViewMode,
    filteredAndSortedAccounts,
    paginatedAccounts,
    handleSort,
  } = query;
  const { toast, showToast, hideToast } = useToast();
  const {
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
  } = useVPNStatusChanges({ onRefresh, showToast });
  const imports = useVPNImports({ onRefresh, showToast });

  // Statistics
  const stats = useMemo(
    () => ({
      total: accounts.length,
      active: accounts.filter((a: VPNAccount) => a.status === "active").length,
      pendingFaculty: accounts.filter(
        (a: VPNAccount) => a.status === "pending_faculty",
      ).length,
      disabled: accounts.filter((a: VPNAccount) => a.status === "disabled")
        .length,
      revoked: accounts.filter((a: VPNAccount) => a.status === "revoked")
        .length,
      management: accounts.filter(
        (a: VPNAccount) => a.portalType === "Management",
      ).length,
      limited: accounts.filter((a: VPNAccount) => a.portalType === "Limited")
        .length,
      external: accounts.filter((a: VPNAccount) => a.portalType === "External")
        .length,
      facultyApproved: accounts.filter((a: VPNAccount) => a.createdByFaculty)
        .length,
    }),
    [accounts],
  );

  const toggleAccountSelection = (accountId: string) => {
    const newSelection = new Set(selectedAccountIds);
    if (newSelection.has(accountId)) {
      newSelection.delete(accountId);
    } else {
      newSelection.add(accountId);
    }
    setSelectedAccountIds(newSelection);
  };

  const toggleAllAccountsSelection = () => {
    if (
      selectedAccountIds.size === paginatedAccounts.length &&
      paginatedAccounts.length > 0
    ) {
      setSelectedAccountIds(new Set());
    } else {
      setSelectedAccountIds(
        new Set(paginatedAccounts.map((a: VPNAccount) => a.id)),
      );
    }
  };

  const selectAllPendingFaculty = () => {
    const pendingAccounts = filteredAndSortedAccounts
      .filter((a: VPNAccount) => a.status === "pending_faculty")
      .map((a: VPNAccount) => a.id);
    setSelectedAccountIds(new Set(pendingAccounts));
    showToast(
      `Selected ${pendingAccounts.length} pending faculty account(s)`,
      "info",
    );
  };

  const toggleTableSelection = (
    accountsList: VPNAccount[],
    checked: boolean,
  ) => {
    const newSelection = new Set(selectedAccountIds);
    if (checked) {
      accountsList.forEach((account) => newSelection.add(account.id));
    } else {
      accountsList.forEach((account) => newSelection.delete(account.id));
    }
    setSelectedAccountIds(newSelection);
  };

  const tableProps = {
    selectedIds: selectedAccountIds,
    onToggleSelection: toggleAccountSelection,
    onViewAccount: (accountId: string) => {
      setSelectedAccountId(accountId);
      setShowDetailModal(true);
    },
    onManageAccount: (account: VPNAccount) => {
      setSelectedAccount(account);
      setNewStatus(account.status);
      setShowStatusModal(true);
    },
    sortField,
    sortDirection,
    onSort: handleSort,
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading VPN accounts...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <VPNManagementOverview
        stats={stats}
        lastUpdated={lastUpdated}
        isPolling={isPolling}
        selectedCount={selectedAccountIds.size}
        onTogglePolling={togglePolling}
        onOpenBulk={() => setShowBulkEditModal(true)}
        onRefresh={refresh}
        onSelectPendingFaculty={selectAllPendingFaculty}
      />

      <VPNManagementFilters
        totalCount={accounts.length}
        filteredCount={filteredAndSortedAccounts.length}
        stats={stats}
        searchQuery={searchQuery}
        filterStatus={filterStatus}
        filterPortal={filterPortal}
        filterFaculty={filterFaculty}
        showAdvancedFilters={showAdvancedFilters}
        viewMode={viewMode}
        setSearchQuery={setSearchQuery}
        setFilterStatus={setFilterStatus}
        setFilterPortal={setFilterPortal}
        setFilterFaculty={setFilterFaculty}
        setShowAdvancedFilters={setShowAdvancedFilters}
        setViewMode={setViewMode}
        setCurrentPage={setCurrentPage}
        exportToCSV={() => exportVPNAccountsCsv(filteredAndSortedAccounts)}
      />

      <VPNImportWorkspace imports={imports} />

      <VPNManagementList
        query={query}
        tableProps={tableProps}
        toggleTableSelection={toggleTableSelection}
      />

      {selectedAccount && (
        <VPNStatusDialog
          selectedAccount={selectedAccount}
          isOpen={showStatusModal}
          newStatus={newStatus}
          statusReason={statusReason}
          statusBadge={getStatusBadge(selectedAccount.status)}
          portalBadge={getPortalBadge(selectedAccount.portalType)}
          onStatusChange={setNewStatus}
          onReasonChange={setStatusReason}
          onSubmit={handleStatusChange}
          onClose={() => {
            setShowStatusModal(false);
            setSelectedAccount(null);
            setNewStatus("");
            setStatusReason("");
          }}
        />
      )}

      {showDetailModal && selectedAccountId && (
        <VPNAccountDetailModal
          accountId={selectedAccountId}
          onClose={() => {
            setShowDetailModal(false);
            setSelectedAccountId(null);
          }}
          onRefresh={onRefresh}
        />
      )}

      <VPNBulkEditModal
        isOpen={showBulkEditModal}
        onClose={() => setShowBulkEditModal(false)}
        selectedAccountIds={selectedAccountIds}
        accounts={accounts}
        bulkNewStatus={bulkNewStatus}
        onStatusChange={setBulkNewStatus}
        bulkReason={bulkReason}
        onReasonChange={setBulkReason}
        bulkFacultyApproval={bulkFacultyApproval}
        onFacultyApprovalChange={setBulkFacultyApproval}
        onSubmit={handleBulkStatusChange}
        onClearSelection={() => setSelectedAccountIds(new Set())}
        onRemoveAccount={toggleAccountSelection}
      />
      <Toast
        message={toast.message}
        type={toast.type}
        isVisible={toast.isVisible}
        onClose={hideToast}
      />
    </div>
  );
}
