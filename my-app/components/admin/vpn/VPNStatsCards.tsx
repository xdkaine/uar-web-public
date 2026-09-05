'use client';

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export interface VPNStats {
  total: number;
  active: number;
  pendingFaculty: number;
  disabled: number;
  revoked: number;
  management: number;
  limited: number;
  external: number;
  facultyApproved: number;
}

interface VPNStatsCardsProps {
  stats: VPNStats;
  isLoading?: boolean;
}

/**
 * Stats cards component for VPN Management Tab
 * Displays account counts by status and portal type
 */
export default function VPNStatsCards({ stats, isLoading = false }: VPNStatsCardsProps) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
        {[...Array(5)].map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-4">
              <div className="h-6 bg-muted rounded mb-2"></div>
              <div className="h-8 bg-muted rounded"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
      <Card className="hover:shadow-md transition-shadow">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Total Accounts</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="text-2xl font-bold text-foreground">{stats.total}</div>
          <div className="text-xs text-muted-foreground mt-1 space-x-2">
            <span className="text-blue-600 dark:text-blue-400">{stats.management} Mgmt</span>
            <span className="text-purple-600 dark:text-purple-400">{stats.limited} Ltd</span>
            <span className="text-orange-600 dark:text-orange-400">{stats.external} Ext</span>
          </div>
        </CardContent>
      </Card>

      <Card className="hover:shadow-md transition-shadow border-l-4 border-l-green-500">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Active</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.active}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {stats.total > 0 ? Math.round((stats.active / stats.total) * 100) : 0}% of total
          </div>
        </CardContent>
      </Card>

      <Card className="hover:shadow-md transition-shadow border-l-4 border-l-yellow-500">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Pending Faculty</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">{stats.pendingFaculty}</div>
          <div className="text-xs text-muted-foreground mt-1">
            Awaiting approval
          </div>
        </CardContent>
      </Card>

      <Card className="hover:shadow-md transition-shadow border-l-4 border-l-red-500">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Disabled</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.disabled}</div>
          <div className="text-xs text-muted-foreground mt-1">
            Temporarily disabled
          </div>
        </CardContent>
      </Card>

      <Card className="hover:shadow-md transition-shadow border-l-4 border-l-purple-500">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Revoked</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="text-2xl font-bold text-purple-600 dark:text-purple-400">{stats.revoked}</div>
          <div className="text-xs text-muted-foreground mt-1">
            Permanently revoked
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
