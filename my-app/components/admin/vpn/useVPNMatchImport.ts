import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithCsrf } from "@/lib/csrf";
import type { VPNImport } from "./vpnADMatchTypes";
import type { useToast } from "@/hooks/useToast";

export function useVPNMatchImport(
  importId: string,
  showToast: ReturnType<typeof useToast>["showToast"],
) {
  const [state, setState] = useState<{
    data: VPNImport | null;
    failed: boolean;
    retrying: boolean;
  }>({ data: null, failed: false, retrying: false });
  const active = useRef(false);
  const load = useRef<AbortController | null>(null);
  const fetchImportData = useCallback(
    async (afterMutation = false) => {
      if (!active.current) return;
      load.current?.abort();
      const controller = new AbortController();
      load.current = controller;
      try {
        const response = await fetchWithCsrf(
          `/api/admin/vpn-import/${importId}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error("Failed to fetch import data");
        const result = await response.json();
        if (controller.signal.aborted) return;
        setState((current) => ({
          ...current,
          data: result.data,
          failed: false,
        }));
      } catch {
        if (controller.signal.aborted) return;
        setState((current) => ({ ...current, failed: true }));
        showToast(
          afterMutation
            ? "Change saved, but failed to reload import data. Retry loading."
            : "Failed to load import data",
          "error",
        );
      }
    },
    [importId, showToast],
  );

  useEffect(() => {
    active.current = true;
    void fetchImportData();
    return () => {
      active.current = false;
      load.current?.abort();
    };
  }, [fetchImportData]);

  const retryLoad = async () => {
    setState((current) => ({ ...current, retrying: true }));
    try {
      await fetchImportData();
    } finally {
      if (active.current)
        setState((current) => ({ ...current, retrying: false }));
    }
  };
  return {
    importData: state.data,
    loadFailed: state.failed,
    retrying: state.retrying,
    fetchImportData,
    retryLoad,
  };
}
