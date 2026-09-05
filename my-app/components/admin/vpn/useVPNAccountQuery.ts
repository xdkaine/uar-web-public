import { useMemo, useState } from "react";
import type { VPNAccount } from "./vpnManagementTypes";
import type {
  StatusFilter,
  PortalFilter,
  FacultyFilter,
} from "../VPNManagementTab";

function searchText(value: string | null | undefined): string {
  return value?.toLowerCase() || "";
}

type VPNSortField = "username" | "name" | "email" | "createdAt" | "expiresAt";

export function useVPNAccountQuery(accounts: VPNAccount[]) {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<StatusFilter>("all");
  const [filterPortal, setFilterPortal] = useState<PortalFilter>("all");
  const [filterFaculty, setFilterFaculty] = useState<FacultyFilter>("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sortField, setSortField] = useState<VPNSortField>("createdAt");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [viewMode, setViewMode] = useState<"unified" | "split">("unified");

  // Filter accounts based on all criteria
  const filteredAccounts = useMemo(() => {
    return accounts.filter((account: VPNAccount) => {
      // Text search filter
      const searchLower = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !searchLower ||
        searchText(account.username).includes(searchLower) ||
        searchText(account.name).includes(searchLower) ||
        searchText(account.email).includes(searchLower) ||
        searchText(account.createdBy).includes(searchLower) ||
        searchText(account.notes).includes(searchLower) ||
        searchText(account.adUsername).includes(searchLower);

      // Status filter
      const matchesStatus =
        filterStatus === "all" || account.status === filterStatus;

      // Portal filter
      const matchesPortal =
        filterPortal === "all" || account.portalType === filterPortal;

      // Faculty filter
      const matchesFaculty =
        filterFaculty === "all" ||
        (filterFaculty === "approved" && account.createdByFaculty) ||
        (filterFaculty === "pending" && !account.createdByFaculty);

      return matchesSearch && matchesStatus && matchesPortal && matchesFaculty;
    });
  }, [accounts, searchQuery, filterStatus, filterPortal, filterFaculty]);

  // Sort accounts
  const filteredAndSortedAccounts = useMemo(() => {
    return [...filteredAccounts].sort((a: VPNAccount, b: VPNAccount) => {
      let aValue: string | number = "";
      let bValue: string | number = "";

      switch (sortField) {
        case "username":
          aValue = searchText(a.username);
          bValue = searchText(b.username);
          break;
        case "name":
          aValue = searchText(a.name);
          bValue = searchText(b.name);
          break;
        case "email":
          aValue = searchText(a.email);
          bValue = searchText(b.email);
          break;
        case "createdAt":
          aValue = new Date(a.createdAt).getTime();
          bValue = new Date(b.createdAt).getTime();
          break;
        case "expiresAt":
          aValue = a.expiresAt ? new Date(a.expiresAt).getTime() : 0;
          bValue = b.expiresAt ? new Date(b.expiresAt).getTime() : 0;
          break;
      }

      if (aValue < bValue) return sortDirection === "asc" ? -1 : 1;
      if (aValue > bValue) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });
  }, [filteredAccounts, sortField, sortDirection]);

  // Paginate accounts
  const totalPages = Math.ceil(filteredAndSortedAccounts.length / pageSize);
  const paginatedAccounts = filteredAndSortedAccounts.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );

  // Split paginated accounts by portal type for split view
  const splitAccounts = useMemo(
    () => ({
      management: paginatedAccounts.filter(
        (a: VPNAccount) => a.portalType === "Management",
      ),
      limited: paginatedAccounts.filter(
        (a: VPNAccount) => a.portalType === "Limited",
      ),
      external: paginatedAccounts.filter(
        (a: VPNAccount) => a.portalType === "External",
      ),
    }),
    [paginatedAccounts],
  );

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortDirection("asc");
    }
  };

  return {
    searchQuery,
    setSearchQuery,
    filterStatus,
    setFilterStatus,
    filterPortal,
    setFilterPortal,
    filterFaculty,
    setFilterFaculty,
    currentPage,
    setCurrentPage,
    pageSize,
    setPageSize,
    sortField,
    sortDirection,
    showAdvancedFilters,
    setShowAdvancedFilters,
    viewMode,
    setViewMode,
    filteredAndSortedAccounts,
    totalPages,
    paginatedAccounts,
    splitAccounts,
    handleSort,
  };
}
