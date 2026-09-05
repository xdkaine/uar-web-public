'use client';

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Search, Download, Filter, RefreshCw, X } from "lucide-react";
import { ClientLocalDate } from "@/components/admin/ClientLocalDate";

export type StatusFilter = 'all' | 'active' | 'pending_faculty' | 'disabled' | 'revoked';
export type PortalFilter = 'all' | 'Management' | 'Limited' | 'External';
export type FacultyFilter = 'all' | 'approved' | 'pending';
export type ViewMode = 'unified' | 'split';

interface VPNFilterBarProps {
  // Search
  searchQuery: string;
  onSearchChange: (query: string) => void;
  
  // Filters
  filterStatus: StatusFilter;
  onStatusChange: (status: StatusFilter) => void;
  filterPortal: PortalFilter;
  onPortalChange: (portal: PortalFilter) => void;
  filterFaculty: FacultyFilter;
  onFacultyChange: (faculty: FacultyFilter) => void;
  
  // View mode
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  
  // Advanced filters
  showAdvancedFilters: boolean;
  onToggleAdvancedFilters: () => void;
  
  // Actions
  onExportCSV: () => void;
  onRefresh: () => void;
  
  // State
  isPolling: boolean;
  onTogglePolling: () => void;
  filteredCount: number;
  totalCount: number;
  lastUpdated: Date | null;
}

/**
 * Filter bar component for VPN Management Tab
 * Provides search, filters, and action buttons
 */
export default function VPNFilterBar({
  searchQuery,
  onSearchChange,
  filterStatus,
  onStatusChange,
  filterPortal,
  onPortalChange,
  filterFaculty,
  onFacultyChange,
  viewMode,
  onViewModeChange,
  showAdvancedFilters,
  onToggleAdvancedFilters,
  onExportCSV,
  onRefresh,
  isPolling,
  onTogglePolling,
  filteredCount,
  totalCount,
  lastUpdated,
}: VPNFilterBarProps) {
  const hasActiveFilters = filterStatus !== 'all' || filterPortal !== 'all' || filterFaculty !== 'all' || searchQuery;
  
  const clearAllFilters = () => {
    onSearchChange('');
    onStatusChange('all');
    onPortalChange('all');
    onFacultyChange('all');
  };

  return (
    <div className="space-y-4 mb-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <label htmlFor="vpn-account-search" className="sr-only">Search VPN accounts</label>
          <Input
            id="vpn-account-search"
            placeholder="Search username, name, email..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10 pr-10"
          />
          {searchQuery && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-muted-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <Select value={filterStatus} onValueChange={(v) => onStatusChange(v as StatusFilter)}>
          <SelectTrigger className="w-[140px]" aria-label="VPN account status">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="pending_faculty">Pending Faculty</SelectItem>
            <SelectItem value="disabled">Disabled</SelectItem>
            <SelectItem value="revoked">Revoked</SelectItem>
          </SelectContent>
        </Select>

        <Select value={filterPortal} onValueChange={(v) => onPortalChange(v as PortalFilter)}>
          <SelectTrigger className="w-[140px]" aria-label="VPN portal">
            <SelectValue placeholder="Portal" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Portals</SelectItem>
            <SelectItem value="Management">Management</SelectItem>
            <SelectItem value="Limited">Limited</SelectItem>
            <SelectItem value="External">External</SelectItem>
          </SelectContent>
        </Select>

        <Button
          type="button"
          variant={showAdvancedFilters ? "default" : "outline"}
          size="sm"
          onClick={onToggleAdvancedFilters}
          aria-expanded={showAdvancedFilters}
          aria-controls="vpn-advanced-filters"
        >
          <Filter className="h-4 w-4 mr-2" />
          Filters
          {hasActiveFilters && (
            <Badge variant="secondary" className="ml-2 bg-blue-100 dark:bg-blue-950/60 text-blue-800">!</Badge>
          )}
        </Button>

        <div className="flex-grow" />

        <Button
          type="button"
          variant={isPolling ? "default" : "outline"}
          size="sm"
          onClick={onTogglePolling}
          aria-pressed={isPolling}
          className={isPolling ? "bg-green-600 hover:bg-green-700" : ""}
        >
          <span className={`inline-block w-2 h-2 rounded-full mr-2 ${isPolling ? 'bg-green-300 animate-pulse' : 'bg-muted-foreground'}`} />
          {isPolling ? 'Live' : 'Off'}
        </Button>

        <Button type="button" variant="outline" size="sm" onClick={onRefresh} aria-label="Refresh VPN accounts">
          <RefreshCw className="h-4 w-4" />
        </Button>

        <Button type="button" variant="outline" size="sm" onClick={onExportCSV}>
          <Download className="h-4 w-4 mr-2" />
          Export
        </Button>
      </div>

      {showAdvancedFilters && (
        <div id="vpn-advanced-filters" className="flex flex-wrap items-center gap-3 p-4 bg-muted/50 rounded-lg border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">Faculty:</span>
            <Select value={filterFaculty} onValueChange={(v) => onFacultyChange(v as FacultyFilter)}>
              <SelectTrigger className="w-[140px]" aria-label="Faculty approval">
                <SelectValue placeholder="Faculty" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="approved">Approved</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">View:</span>
            <Select value={viewMode} onValueChange={(v) => onViewModeChange(v as ViewMode)}>
              <SelectTrigger className="w-[120px]" aria-label="VPN results view">
                <SelectValue placeholder="View" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unified">Unified</SelectItem>
                <SelectItem value="split">Split by Portal</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {hasActiveFilters && (
            <Button type="button" variant="ghost" size="sm" onClick={clearAllFilters} className="text-red-600 dark:text-red-400">
              <X className="h-4 w-4 mr-1" />
              Clear Filters
            </Button>
          )}

          <div className="flex-grow" />
          <span className="text-sm text-muted-foreground">
            Showing {filteredCount} of {totalCount} accounts
            {lastUpdated && (
              <span className="ml-2 text-muted-foreground">
                • Updated <ClientLocalDate value={lastUpdated} format="time" />
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  );
}
