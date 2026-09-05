import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Search, Download, Filter } from "lucide-react";
import type {
  StatusFilter,
  PortalFilter,
  FacultyFilter,
} from "../VPNManagementTab";
import type { VPNStats } from "./VPNStatsCards";

interface VPNManagementFiltersProps {
  totalCount: number;
  filteredCount: number;
  stats: Pick<
    VPNStats,
    "management" | "limited" | "external" | "facultyApproved"
  >;
  searchQuery: string;
  filterStatus: StatusFilter;
  filterPortal: PortalFilter;
  filterFaculty: FacultyFilter;
  showAdvancedFilters: boolean;
  viewMode: "unified" | "split";
  setSearchQuery: (value: string) => void;
  setFilterStatus: (value: StatusFilter) => void;
  setFilterPortal: (value: PortalFilter) => void;
  setFilterFaculty: (value: FacultyFilter) => void;
  setShowAdvancedFilters: (value: boolean) => void;
  setViewMode: (value: "unified" | "split") => void;
  setCurrentPage: (value: number) => void;
  exportToCSV: () => void;
}

export default function VPNManagementFilters({
  totalCount,
  filteredCount,
  stats,
  searchQuery,
  filterStatus,
  filterPortal,
  filterFaculty,
  showAdvancedFilters,
  viewMode,
  setSearchQuery,
  setFilterStatus,
  setFilterPortal,
  setFilterFaculty,
  setShowAdvancedFilters,
  setViewMode,
  setCurrentPage,
  exportToCSV,
}: VPNManagementFiltersProps) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex flex-wrap gap-6 text-sm mb-6">
          <div>
            <span className="font-semibold text-muted-foreground">Total:</span>
            <span className="ml-2 text-foreground font-bold">{totalCount}</span>
          </div>
          <div>
            <span className="font-semibold text-muted-foreground">
              Filtered:
            </span>
            <span className="ml-2 text-blue-600 dark:text-blue-400 font-bold">
              {filteredCount}
            </span>
          </div>
          <div>
            <span className="font-semibold text-muted-foreground">
              Management:
            </span>
            <span className="ml-2 text-blue-600 dark:text-blue-400 font-bold">
              {stats.management}
            </span>
          </div>
          <div>
            <span className="font-semibold text-muted-foreground">
              Limited:
            </span>
            <span className="ml-2 text-purple-600 dark:text-purple-400 font-bold">
              {stats.limited}
            </span>
          </div>
          <div>
            <span className="font-semibold text-muted-foreground">
              External:
            </span>
            <span className="ml-2 text-orange-600 dark:text-orange-400 font-bold">
              {stats.external}
            </span>
          </div>
          <div>
            <span className="font-semibold text-muted-foreground">
              Faculty Approved:
            </span>
            <span className="ml-2 text-green-600 dark:text-green-400 font-bold">
              {stats.facultyApproved}
            </span>
          </div>
        </div>

        <div className="flex gap-3 mb-4">
          <div className="flex-1">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Search by username, name, email, or created by..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setCurrentPage(1);
                }}
                className="pl-8"
              />
            </div>
          </div>
          <Button
            variant="default"
            onClick={exportToCSV}
            className="gap-2"
            title="Export filtered results to CSV"
          >
            <Download className="w-4 h-4" />
            Export
          </Button>
          <Button
            variant={showAdvancedFilters ? "secondary" : "outline"}
            onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
          >
            <Filter className="w-4 h-4 mr-2" />
            {showAdvancedFilters ? "Hide Filters" : "Advanced Filters"}
          </Button>
          {(searchQuery ||
            filterStatus !== "all" ||
            filterPortal !== "all" ||
            filterFaculty !== "all") && (
            <Button
              variant="destructive"
              onClick={() => {
                setSearchQuery("");
                setFilterStatus("all");
                setFilterPortal("all");
                setFilterFaculty("all");
                setCurrentPage(1);
              }}
            >
              Clear All
            </Button>
          )}
        </div>

        {showAdvancedFilters && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-4 border-t border-border">
            <div className="space-y-2">
              <Label>Status</Label>
              <Select
                value={filterStatus}
                onValueChange={(value) => {
                  setFilterStatus(value as StatusFilter);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All Statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="pending_faculty">
                    Pending Faculty
                  </SelectItem>
                  <SelectItem value="disabled">Disabled</SelectItem>
                  <SelectItem value="revoked">Revoked</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Portal Type</Label>
              <Select
                value={filterPortal}
                onValueChange={(value) => {
                  setFilterPortal(value as PortalFilter);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All Portals" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Portals</SelectItem>
                  <SelectItem value="Management">
                    Internal - Management
                  </SelectItem>
                  <SelectItem value="Limited">Internal - Limited</SelectItem>
                  <SelectItem value="External">External</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Faculty Approval</Label>
              <Select
                value={filterFaculty}
                onValueChange={(value) => {
                  setFilterFaculty(value as FacultyFilter);
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="approved">Faculty Approved</SelectItem>
                  <SelectItem value="pending">Pending Approval</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        <div className="flex gap-3 mt-4 pt-4 border-t border-border">
          <span className="text-sm font-semibold text-muted-foreground">
            View Mode:
          </span>
          <Button
            variant={viewMode === "unified" ? "default" : "outline"}
            onClick={() => setViewMode("unified")}
            size="sm"
          >
            Unified List
          </Button>
          <Button
            variant={viewMode === "split" ? "default" : "outline"}
            onClick={() => setViewMode("split")}
            size="sm"
          >
            Split by Portal
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
