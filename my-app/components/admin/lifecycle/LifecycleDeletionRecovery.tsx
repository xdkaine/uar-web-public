"use client";

import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { fetchWithCsrf } from "@/lib/csrf";
import { isUnfinishedDeletion } from "./lifecycleDeletionRecoveryUtils";

interface InterruptedDeletion {
  id: string;
  description: string;
  status: string;
  requestedBy: string;
  relatedTicketId: string | null;
  totalActions: number;
  recordedActions: number;
  canFinalize: boolean;
  isExpired: boolean;
}

export default function LifecycleDeletionRecovery({
  disabled = false,
  onRecovered,
}: {
  disabled?: boolean;
  onRecovered: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [plans, setPlans] = useState<InterruptedDeletion[]>([]);
  const [loading, setLoading] = useState(false);
  const [finalizing, setFinalizing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetchWithCsrf(
        "/api/admin/account-lifecycle/deletion-plans?unfinished=true&limit=50",
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Unable to load interrupted deletions");
      setPlans((data.plans ?? []).filter(isUnfinishedDeletion));
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to load interrupted deletions",
      );
    } finally {
      setLoading(false);
    }
  };

  const finalize = async (id: string) => {
    setFinalizing(id);
    setError("");
    setNotice("");
    try {
      const response = await fetchWithCsrf(
        `/api/admin/account-lifecycle/deletion-plans/${encodeURIComponent(id)}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      const data = await response.json();
      if (!response.ok)
        throw new Error(data.error || "Unable to finalize recorded outcomes");
      setNotice(
        "Recorded outcomes finalized. Any uncertain actions still require reconciliation in Operations. No account action was replayed.",
      );
      onRecovered();
      await load();
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Unable to finalize recorded outcomes",
      );
    } finally {
      setFinalizing(null);
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          setNotice("");
          void load();
        }}
      >
        <AlertTriangle className="h-4 w-4" /> Interrupted deletions
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Interrupted deletions</DialogTitle>
            <DialogDescription>
              Up to 50 unfinished confirmations, oldest first, including those
              with no recorded actions. Finalizing records the existing outcomes
              and marks missing actions as not attempted; it does not delete
              accounts or retry work.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          {notice && (
            <p role="status" className="text-sm">
              {notice}
            </p>
          )}
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading interrupted
              deletions…
            </p>
          ) : !error && plans.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No unfinished deletions.
            </p>
          ) : (
            <div className="space-y-3">
              {plans.map((plan) => (
                <div
                  key={plan.id}
                  className="space-y-2 rounded-md border p-3 text-sm"
                >
                  <p className="font-medium">{plan.description}</p>
                  <p className="break-all font-mono text-xs text-muted-foreground">
                    {plan.id}
                  </p>
                  <p className="text-muted-foreground">
                    {plan.recordedActions} of {plan.totalActions} actions
                    recorded · {plan.requestedBy} ·{" "}
                    {plan.relatedTicketId || "No reference"}
                  </p>
                  {plan.status === "reconciliation_required" ? (
                    <p className="text-amber-700 dark:text-amber-300">
                      Reconcile the uncertain actions in Operations first. Do
                      not retry the deletion.
                    </p>
                  ) : plan.canFinalize && plan.isExpired ? (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={Boolean(finalizing)}
                      onClick={() => void finalize(plan.id)}
                    >
                      {finalizing === plan.id && (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      )}{" "}
                      Finalize recorded outcomes
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {plan.canFinalize
                        ? "Recovery becomes available when this confirmation expires."
                        : "Only the confirming operator can finalize these outcomes."}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
          <Button
            variant="outline"
            disabled={loading || Boolean(finalizing)}
            onClick={() => void load()}
          >
            Refresh interrupted deletions
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
