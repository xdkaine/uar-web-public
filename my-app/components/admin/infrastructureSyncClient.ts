import { fetchWithCsrf } from "@/lib/csrf";

export interface InfrastructureSyncStats {
  totalADAccounts: number;
  newAccessRequests: number;
  newVPNAccounts: number;
  skippedDuplicates: number;
  errors: number;
}

export interface InfrastructureSyncStatus {
  id: string;
  status: "running" | "completed" | "failed" | "partial";
  startedAt: string;
  completedAt: string | null;
  triggeredBy: string;
  totalADAccounts: number;
  autoAssigned: number;
  notes: string | null;
  errorMessage?: string;
  matches?: Array<{
    id: string;
    adUsername: string;
    adDisplayName: string;
    adEmail: string;
    vpnUsername: string | null;
    accessRequestId: string | null;
    matchType: string;
    wasAutoAssigned: boolean;
    notes: string | null;
  }>;
  taggingTasks?: Array<{
    id: string;
    adUsername: string;
    accessRequestId: string;
    status: string;
    attempts: number;
    lastError: string | null;
    updatedAt: string;
  }>;
}

export interface InfrastructureSyncResult {
  syncId: string;
  status: "completed" | "partial" | "failed";
  stats: InfrastructureSyncStats;
  records: Array<{
    adUsername: string;
    adEmail: string;
    adDisplayName: string;
    action: "created" | "skipped_duplicate" | "error";
    accessRequestId: string | null;
    vpnAccountId: string | null;
    errorMessage?: string;
  }>;
  error?: string;
}

export async function fetchLatestInfrastructureSync(): Promise<InfrastructureSyncStatus | null> {
  const response = await fetchWithCsrf(
    "/api/admin/settings/infrastructure-sync?action=status",
  );
  if (!response.ok) throw new Error("Failed to fetch sync status");
  const result = await response.json();
  return result.success && result.data ? result.data : null;
}

export async function runInfrastructureSync(
  dryRun: boolean,
): Promise<InfrastructureSyncResult> {
  const response = await fetchWithCsrf(
    "/api/admin/settings/infrastructure-sync",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dryRun }),
    },
  );
  const result = await response.json();
  if (!response.ok && response.status !== 207)
    throw new Error(result.error || "Sync failed");
  if (!result.success && !result.partial)
    throw new Error(result.error || "Sync failed");
  return result.data;
}
