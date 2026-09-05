"use client";

import { useState } from "react";
import useSWR from "swr";

import {
  BatchAccountsList,
  BatchAuditList,
  BatchDetailTabs,
  BatchSummary,
  type BatchDetail,
} from "./BatchDetailSections";
import { fetchJson } from "@/lib/client-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BatchDetailModalProps {
  batchId: string | null;
  onClose: () => void;
}

export default function BatchDetailModal({
  batchId,
  onClose,
}: BatchDetailModalProps) {
  const [activeTab, setActiveTab] = useState<"accounts" | "audit">("accounts");
  const { data, error, isLoading } = useSWR<{ batch: BatchDetail }>(
    batchId ? `/api/admin/batch-accounts/${batchId}` : null,
    fetchJson,
  );
  if (!batchId) return null;
  const batch = data?.batch;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-6xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Batch Operation Details</DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex justify-center items-center py-16">
            <div className="text-muted-foreground text-lg">
              Loading batch details...
            </div>
          </div>
        ) : error || !batch ? (
          <div role="alert" className="py-12 text-center text-destructive">
            Failed to load batch details
          </div>
        ) : (
          <div className="space-y-8">
            <BatchSummary batch={batch} />
            <BatchDetailTabs
              activeTab={activeTab}
              batch={batch}
              onTabChange={setActiveTab}
            />
            {activeTab === "accounts" ? (
              <BatchAccountsList accounts={batch.accounts} />
            ) : (
              <BatchAuditList auditLogs={batch.auditLogs} />
            )}
            <div className="flex justify-end pt-6 border-t border-border">
              <button
                onClick={onClose}
                className="bg-primary text-primary-foreground px-8 py-3 rounded-lg hover:bg-primary/90 transition-colors font-semibold text-base shadow-md"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
