"use client";

import { useEffect, useState } from "react";

import { fetchWithCsrf } from "@/lib/csrf";
import { EMPTY_SUMMARY, type InventoryResponse } from "./lifecycleAccountsWorkspaceUtils";

export function useLifecycleAccountsInventory() {
  const [inventory, setInventory] = useState<InventoryResponse>({
    accounts: [], readOnly: false, vpnModuleEnabled: true, summary: EMPTY_SUMMARY,
  });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadAccounts = async () => {
    setLoading(true); setLoadError(null);
    try {
      const response = await fetchWithCsrf("/api/admin/account-lifecycle/inventory");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to load account inventory");
      setInventory({ accounts: Array.isArray(data.accounts) ? data.accounts : [], readOnly: Boolean(data.readOnly), vpnModuleEnabled: data.vpnModuleEnabled !== false, summary: data.summary ?? EMPTY_SUMMARY });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load account inventory");
    } finally { setLoading(false); }
  };
  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadAccounts(), 0);
    return () => window.clearTimeout(initialLoad);
  }, []);
  return { inventory, loading, loadError, loadAccounts };
}
