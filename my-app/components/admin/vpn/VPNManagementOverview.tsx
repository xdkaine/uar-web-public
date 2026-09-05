"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, Filter, RefreshCw } from "lucide-react";
import { ClientLocalDate } from "@/components/admin/ClientLocalDate";
import type { VPNStats } from "./VPNStatsCards";

interface Props {
  stats: VPNStats;
  lastUpdated: Date | null;
  isPolling: boolean;
  selectedCount: number;
  onTogglePolling: () => void;
  onOpenBulk: () => void;
  onRefresh: () => void;
  onSelectPendingFaculty: () => void;
}

export default function VPNManagementOverview({
  stats,
  lastUpdated,
  isPolling,
  selectedCount,
  onTogglePolling,
  onOpenBulk,
  onRefresh,
  onSelectPendingFaculty,
}: Props) {
  return (
    <>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h2 className="text-2xl font-bold">VPN Account Management</h2>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mr-2">
            {lastUpdated && (
              <span>Updated: <ClientLocalDate value={lastUpdated} format="time" /></span>
            )}
          </div>

          <Button
            variant={isPolling ? "default" : "outline"}
            onClick={onTogglePolling}
            className={`gap-2 ${isPolling ? "bg-green-100 dark:bg-green-950/60 text-green-700 dark:text-green-200 hover:bg-green-200 border-green-200 dark:border-green-900" : ""}`}
            size="sm"
          >
            <div
              className={`w-2 h-2 rounded-full ${isPolling ? "bg-green-500 animate-pulse" : "bg-muted-foreground"}`}
            />
            {isPolling ? "Live" : "Off"}
          </Button>

          {selectedCount > 0 && (
            <Button
              variant="default"
              onClick={onOpenBulk}
              className="bg-blue-600 hover:bg-blue-700 gap-2"
              size="sm"
            >
              <Filter className="w-4 h-4" />
              Bulk ({selectedCount})
            </Button>
          )}

          <Button
            variant="default"
            onClick={onRefresh}
            className="bg-primary hover:bg-foreground/90 gap-2"
            size="sm"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 sm:gap-4">
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="text-muted-foreground text-xs sm:text-sm font-medium">
              Total Accounts
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-foreground mt-2">
              {stats.total}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="text-muted-foreground text-xs sm:text-sm font-medium">
              Active
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-green-600 dark:text-green-400 mt-2">
              {stats.active}
            </div>
          </CardContent>
        </Card>
        <Card
          className="cursor-pointer hover:bg-yellow-50 dark:bg-yellow-950/40 transition-colors border-yellow-300"
          onClick={onSelectPendingFaculty}
          title="Click to select all pending faculty accounts for bulk editing"
        >
          <CardContent className="p-4 sm:p-6">
            <div className="text-muted-foreground text-xs sm:text-sm font-medium flex items-center gap-1">
              Pending Faculty
              <AlertTriangle className="w-4 h-4 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-yellow-500 mt-2">
              {stats.pendingFaculty}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="text-muted-foreground text-xs sm:text-sm font-medium">
              Disabled
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-red-500 mt-2">
              {stats.disabled}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 sm:p-6">
            <div className="text-muted-foreground text-xs sm:text-sm font-medium">
              Revoked
            </div>
            <div className="text-2xl sm:text-3xl font-bold text-purple-600 dark:text-purple-400 mt-2">
              {stats.revoked}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
