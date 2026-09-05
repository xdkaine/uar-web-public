"use client";

import { useState, useEffect, useReducer, useRef } from "react";
import { useToast } from "@/hooks/useToast";
import { fetchWithCsrf } from "@/lib/csrf";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

import VPNMatchHeader from "./vpn/VPNMatchHeader";
import VPNMatchRecords from "./vpn/VPNMatchRecords";
import VPNMatchEditor from "./vpn/VPNMatchEditor";
import {
  initialVPNMatchDraft,
  vpnMatchDraftReducer,
} from "./vpn/vpnMatchDraft";
import { useVPNMatchImport } from "./vpn/useVPNMatchImport";

interface VPNADMatchModalProps {
  importId: string;
  onClose: () => void;
  onComplete: () => void;
}

export default function VPNADMatchModal(props: VPNADMatchModalProps) {
  return <VPNADMatchSession key={props.importId} {...props} />;
}

function VPNADMatchSession({
  importId,
  onClose,
  onComplete,
}: VPNADMatchModalProps) {
  const [draft, dispatchDraft] = useReducer(
    vpnMatchDraftReducer,
    initialVPNMatchDraft,
  );
  const {
    selectedRecord,
    adSearchQuery,
    adSearchResults,
    isSearching,
    matchNotes,
  } = draft;
  const [isMatching, setIsMatching] = useState(false);
  const [filterStatus, setFilterStatus] = useState<string>("all");
  const { toast, showToast, hideToast } = useToast();
  const searchLoad = useRef<AbortController | null>(null);
  const sessionActive = useRef(false);
  const mutationPending = useRef(false);

  const { importData, loadFailed, retrying, fetchImportData, retryLoad } =
    useVPNMatchImport(importId, showToast);
  useEffect(() => {
    sessionActive.current = true;
    return () => {
      sessionActive.current = false;
      searchLoad.current?.abort();
    };
  }, []);

  const searchAD = async () => {
    if (!adSearchQuery.trim()) {
      showToast("Please enter a search query", "error");
      return;
    }

    searchLoad.current?.abort();
    const controller = new AbortController();
    searchLoad.current = controller;
    dispatchDraft({ type: "searchStarted" });
    try {
      const response = await fetchWithCsrf(
        `/api/admin/ad-search?q=${encodeURIComponent(adSearchQuery)}`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error("Search failed");
      const result = await response.json();
      if (controller.signal.aborted) return;
      const results = result.data || [];
      dispatchDraft({ type: "searchSucceeded", results });

      if (results.length === 0) {
        showToast("No AD accounts found", "info");
      }
    } catch {
      if (!controller.signal.aborted) {
        dispatchDraft({ type: "searchFailed" });
        showToast("Failed to search Active Directory", "error");
      }
    }
  };

  const handleMatch = async (adUsername: string) => {
    if (!selectedRecord || mutationPending.current) return;

    mutationPending.current = true;
    setIsMatching(true);
    try {
      const response = await fetchWithCsrf("/api/admin/vpn-import/match", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordId: selectedRecord.id,
          adUsername,
          matchNotes,
        }),
      });

      if (!response.ok) throw new Error("Failed to match account");
      if (!sessionActive.current) return;

      showToast("Successfully matched to AD account", "success");
      dispatchDraft({ type: "cleared" });
      await fetchImportData(true);
    } catch {
      if (sessionActive.current) showToast("Failed to match account", "error");
    } finally {
      mutationPending.current = false;
      if (sessionActive.current) setIsMatching(false);
    }
  };

  const handleMarkAsNoMatch = async (recordId: string) => {
    if (mutationPending.current) return;
    mutationPending.current = true;
    setIsMatching(true);
    searchLoad.current?.abort();
    dispatchDraft({ type: "searchFailed" });
    try {
      const response = await fetchWithCsrf("/api/admin/vpn-import/match", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recordId,
          matchStatus: "no_match",
          matchNotes: "No matching AD account found",
        }),
      });

      if (!response.ok) throw new Error("Failed to update status");
      if (!sessionActive.current) return;

      showToast("Marked as no match", "success");
      if (selectedRecord?.id === recordId) dispatchDraft({ type: "cleared" });
      await fetchImportData(true);
    } catch {
      if (sessionActive.current) showToast("Failed to update status", "error");
    } finally {
      mutationPending.current = false;
      if (sessionActive.current) setIsMatching(false);
    }
  };

  const filteredRecords =
    importData?.importRecords.filter((record) => {
      if (filterStatus === "all") return true;
      return record.matchStatus === filterStatus;
    }) || [];

  const retryImport = () => {
    hideToast();
    void retryLoad();
  };

  if (!importData) {
    return (
      <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
          <DialogTitle className="sr-only">
            Match VPN Users to Active Directory
          </DialogTitle>
          <VPNMatchFeedback toast={toast} onDismiss={hideToast} />
          {loadFailed ? (
            <Button disabled={retrying} onClick={retryImport}>
              {retrying ? "Retrying..." : "Retry loading"}
            </Button>
          ) : (
            <div className="flex justify-center items-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-foreground"></div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog
      open={true}
      onOpenChange={(open) => !open && !mutationPending.current && onClose()}
    >
      <DialogContent
        showCloseButton={!isMatching}
        className="max-w-7xl max-h-[90vh] overflow-y-auto w-full"
      >
        <VPNMatchHeader importData={importData} />

        <VPNMatchFeedback toast={toast} onDismiss={hideToast} />
        {loadFailed && (
          <Button disabled={retrying} onClick={retryImport}>
            {retrying ? "Retrying..." : "Retry loading"}
          </Button>
        )}
        {isMatching && (
          <p role="status">Saving match changes. Please wait before closing.</p>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 h-full min-h-[500px]">
          <VPNMatchRecords
            records={filteredRecords}
            selectedRecordId={selectedRecord?.id}
            filterStatus={filterStatus}
            onFilterStatusChange={setFilterStatus}
            isMatching={isMatching || loadFailed}
            onSelectRecord={(record) => {
              searchLoad.current?.abort();
              dispatchDraft({ type: "recordSelected", record });
            }}
            onMarkAsNoMatch={handleMarkAsNoMatch}
          />
          <VPNMatchEditor
            selectedRecord={selectedRecord}
            adSearchQuery={adSearchQuery}
            onQueryChange={(query) => {
              searchLoad.current?.abort();
              dispatchDraft({ type: "queryEdited", query });
            }}
            adSearchResults={adSearchResults}
            isSearching={isSearching}
            isMatching={isMatching || loadFailed}
            matchNotes={matchNotes}
            onNotesChange={(notes) =>
              dispatchDraft({ type: "notesEdited", notes })
            }
            onSearch={searchAD}
            onMatch={handleMatch}
            onCancel={() => {
              searchLoad.current?.abort();
              dispatchDraft({ type: "cleared" });
            }}
          />
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="outline" disabled={isMatching} onClick={onClose}>
            Close
          </Button>
          <Button
            disabled={isMatching}
            onClick={() => {
              onComplete();
              onClose();
            }}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function VPNMatchFeedback({
  toast,
  onDismiss,
}: {
  toast: ReturnType<typeof useToast>["toast"];
  onDismiss: () => void;
}) {
  return (
    <div aria-live="polite">
      {toast.isVisible && (
        <Alert
          variant={toast.type === "error" ? "destructive" : "default"}
          role="status"
        >
          <AlertDescription>
            <p>{toast.message}</p>
            <Button variant="ghost" size="sm" onClick={onDismiss}>
              Dismiss notification
            </Button>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
