import { useCallback, useState } from "react";
import type { RequestConfirmationConfig } from "./RequestConfirmationDialogs";

export function useRequestActionCoordinator() {
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState("");
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmModalConfig, setConfirmModalConfig] =
    useState<RequestConfirmationConfig | null>(null);

  const openConfirmation = useCallback(
    (confirmation: RequestConfirmationConfig) => {
      setConfirmModalConfig(confirmation);
      setShowConfirmModal(true);
    },
    [],
  );
  const closeConfirmation = useCallback(() => setShowConfirmModal(false), []);
  const clearConfirmation = useCallback(() => {
    setShowConfirmModal(false);
    setConfirmModalConfig(null);
  }, []);
  const onActionStart = useCallback(() => {
    setActionLoading(true);
    setError("");
  }, []);
  const onRecoveryStart = useCallback(() => setActionLoading(true), []);
  const onActionComplete = useCallback(() => setActionLoading(false), []);

  return {
    actionLoading,
    error,
    showConfirmModal,
    confirmModalConfig,
    openConfirmation,
    closeConfirmation,
    clearConfirmation,
    onActionStart,
    onRecoveryStart,
    onActionComplete,
    onActionError: setError,
  };
}
