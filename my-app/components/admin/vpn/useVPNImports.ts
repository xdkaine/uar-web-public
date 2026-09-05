import { useCallback, useState } from "react";
import {
  clearVPNImportQueue,
  cleanupVPNImports,
  fetchVPNImports,
  fetchVPNImportsIfOk,
  processVPNImport,
  type VPNImportSummary,
} from "./vpnImportActions";

type Toast = (
  message: string,
  variant: "success" | "error" | "warning",
) => void;
interface UseVPNImportsOptions {
  onRefresh: () => void;
  showToast: Toast;
}

export function useVPNImports({ onRefresh, showToast }: UseVPNImportsOptions) {
  const [showImportModal, setShowImportModal] = useState(false);
  const [importUserType, setImportUserType] = useState<"Internal" | "External">(
    "Internal",
  );
  const [importPortalType, setImportPortalType] = useState<
    "Management" | "Limited"
  >("Management");
  const [showImportQueueModal, setShowImportQueueModal] = useState(false);
  const [imports, setImports] = useState<VPNImportSummary[]>([]);
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const [showMatchModal, setShowMatchModal] = useState(false);
  const [isProcessingImport, setIsProcessingImport] = useState(false);
  const [showClearQueueConfirm, setShowClearQueueConfirm] = useState(false);
  const openImport = useCallback(
    (
      userType: "Internal" | "External",
      portalType?: "Management" | "Limited",
    ) => {
      setImportUserType(userType);
      setImportPortalType(portalType as "Management" | "Limited");
      setShowImportModal(true);
    },
    [],
  );
  const openQueue = useCallback(async () => {
    try {
      const result = await fetchVPNImports();
      setImports(result.data || []);
      setShowImportQueueModal(true);
    } catch (error) {
      console.error("Failed to load imports:", error);
      showToast("Failed to load import queue", "error");
    }
  }, [showToast]);
  const refreshImports = useCallback(async () => {
    const result = await fetchVPNImportsIfOk();
    if (result) setImports(result.data || []);
  }, []);
  const processImport = useCallback(
    async (importId: string) => {
      setIsProcessingImport(true);
      try {
        const result = await processVPNImport(importId);
        showToast(
          `Created ${result.data.createdCount} VPN accounts`,
          "success",
        );
        await refreshImports();
        onRefresh();
      } catch {
        showToast("Failed to process import", "error");
      } finally {
        setIsProcessingImport(false);
      }
    },
    [onRefresh, refreshImports, showToast],
  );
  const cleanupExpired = useCallback(async () => {
    try {
      const result = await cleanupVPNImports();
      showToast(result.data.message, "success");
      await refreshImports();
    } catch {
      showToast("Failed to cleanup expired imports", "error");
    }
  }, [refreshImports, showToast]);
  const confirmClearQueue = useCallback(async () => {
    try {
      const result = await clearVPNImportQueue();
      showToast(result.data.message, "success");
      if (showImportQueueModal) setImports([]);
    } catch (error) {
      console.error("Failed to clear import queue:", error);
      showToast("Failed to clear import queue", "error");
    } finally {
      setShowClearQueueConfirm(false);
    }
  }, [showImportQueueModal, showToast]);
  const openMatch = useCallback((importId: string) => {
    setSelectedImportId(importId);
    setShowMatchModal(true);
    setShowImportQueueModal(false);
  }, []);
  const closeMatch = useCallback(() => {
    setShowMatchModal(false);
    setSelectedImportId(null);
  }, []);
  return {
    showImportModal,
    importUserType,
    importPortalType,
    showImportQueueModal,
    imports,
    selectedImportId,
    showMatchModal,
    isProcessingImport,
    showClearQueueConfirm,
    openImport,
    openQueue,
    processImport,
    cleanupExpired,
    confirmClearQueue,
    openMatch,
    closeMatch,
    setShowImportModal,
    setShowImportQueueModal,
    setShowClearQueueConfirm,
    onRefresh,
  };
}
