import { fetchWithCsrf } from "@/lib/csrf";

export async function fetchVPNImports() {
  const response = await fetchWithCsrf("/api/admin/vpn-import");
  if (!response.ok) throw new Error("Failed to fetch imports");
  return (await response.json()) as { data?: VPNImportSummary[] };
}

export async function fetchVPNImportsIfOk() {
  const response = await fetchWithCsrf("/api/admin/vpn-import");
  if (!response.ok) return undefined;
  return (await response.json()) as { data?: VPNImportSummary[] };
}

export async function processVPNImport(importId: string) {
  const response = await fetchWithCsrf("/api/admin/vpn-import/process", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ importId }),
  });
  if (!response.ok) throw new Error("Failed to process import");
  return (await response.json()) as { data: { createdCount: number } };
}

export async function cleanupVPNImports() {
  const response = await fetchWithCsrf("/api/admin/vpn-import/cleanup", {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("Failed to cleanup");
  return (await response.json()) as { data: { message: string } };
}

export async function clearVPNImportQueue() {
  const response = await fetchWithCsrf("/api/admin/vpn-import/clear", {
    method: "DELETE",
  });
  if (!response.ok) throw new Error("Failed to clear queue");
  return (await response.json()) as { data: { message: string } };
}

export interface VPNImportSummary {
  id: string;
  fileName: string;
  userType: string;
  portalType?: string | null;
  importedBy: string;
  createdAt: string;
  totalRecords?: number | null;
  matchedRecords?: number | null;
  unmatchedRecords?: number | null;
  createdAccounts?: number | null;
  status?: string | null;
}
