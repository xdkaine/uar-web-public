"use client";

import { useEffect, useState } from "react";
import { requestActionImpact } from "@/components/admin/actionImpactRequest";
import {
  InfrastructureSyncControls,
  InfrastructureSyncIntroduction,
  InfrastructureSyncMessage,
  InfrastructureSyncNotes,
  InfrastructureSyncResults,
  InfrastructureSyncStatusCard,
} from "./InfrastructureSyncViews";
import {
  fetchLatestInfrastructureSync,
  runInfrastructureSync,
  type InfrastructureSyncResult,
  type InfrastructureSyncStatus,
} from "./infrastructureSyncClient";

type SyncMessage = { type: "success" | "error" | "info"; text: string };

export default function InfrastructureSyncPanel() {
  const [isRunning, setIsRunning] = useState(false);
  const [latestSync, setLatestSync] = useState<InfrastructureSyncStatus | null>(
    null,
  );
  const [lastResult, setLastResult] = useState<InfrastructureSyncResult | null>(
    null,
  );
  const [message, setMessage] = useState<SyncMessage | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const showMessage = (text: string, type: SyncMessage["type"] = "info") => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 8000);
  };
  const fetchLatestSync = async () => {
    try {
      setLatestSync(await fetchLatestInfrastructureSync());
    } catch (error) {
      console.error("Error fetching sync status:", error);
    }
  };
  useEffect(() => {
    void fetchLatestSync();
  }, []);

  const runSync = async (dryRun = false) => {
    if (isRunning) return;
    const decision = await requestActionImpact({
      title: dryRun ? "Preview infrastructure sync" : "Run infrastructure sync",
      description: dryRun
        ? "Run a dry run to preview what accounts would be synced?"
        : "This will create AccessRequest and VPNAccount records for all existing AD accounts with @cpp.edu emails. Continue?",
      items: [
        {
          label: "Mode",
          value: dryRun
            ? "Dry run; no records created"
            : "Creates portal request and VPN records",
        },
        { label: "Directory", value: "Read-only discovery", tone: "warning" },
      ],
      confirmLabel: dryRun ? "Run preview" : "Start sync",
      destructive: !dryRun,
      evidence:
        "The run summary and per-account outcomes are retained for reconciliation.",
    });
    if (!decision.confirmed) return;
    setIsRunning(true);
    setLastResult(null);
    showMessage(
      dryRun
        ? "Running dry run - no records will be created..."
        : "Running infrastructure sync - this may take a few minutes...",
    );
    try {
      const result = await runInfrastructureSync(dryRun);
      setLastResult(result);
      showMessage(
        dryRun
          ? `Dry run completed: Found ${result.stats.totalADAccounts} AD accounts. Would create ${result.stats.newAccessRequests} AccessRequests and ${result.stats.newVPNAccounts} VPNAccounts. ${result.stats.skippedDuplicates} duplicates would be skipped.`
          : `Infrastructure sync completed! Created ${result.stats.newAccessRequests} AccessRequests and ${result.stats.newVPNAccounts} VPNAccounts. Skipped ${result.stats.skippedDuplicates} duplicates. ${result.stats.errors > 0 ? `${result.stats.errors} errors occurred.` : ""}`,
        dryRun || result.stats.errors === 0 ? "success" : "info",
      );
      await fetchLatestSync();
    } catch (error) {
      console.error("Sync error:", error);
      showMessage(
        error instanceof Error
          ? error.message
          : "Failed to run infrastructure sync",
        "error",
      );
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <InfrastructureSyncIntroduction />
      <InfrastructureSyncControls
        isRunning={isRunning}
        onRun={(dryRun) => void runSync(dryRun)}
        onRefresh={() => void fetchLatestSync()}
      />
      <InfrastructureSyncMessage message={message} />
      <InfrastructureSyncStatusCard latestSync={latestSync} />
      <InfrastructureSyncResults
        result={lastResult}
        showDetails={showDetails}
        onToggleDetails={() => setShowDetails((current) => !current)}
      />
      <InfrastructureSyncNotes />
    </div>
  );
}
