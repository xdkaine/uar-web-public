"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Search } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { usePolling } from "@/hooks/usePolling";
import { useToast } from "@/hooks/useToast";
import { fetchWithCsrf } from "@/lib/csrf";
import { cn } from "@/lib/utils";
import {
  DEFAULT_OPERATION_FILTERS,
  INITIAL_OPERATION_VIEW,
  LIFECYCLE_ACTION_LABELS,
  LIFECYCLE_SCOPE_LABELS,
  LIFECYCLE_SORT_LABELS,
  LIFECYCLE_STATUS_LABELS,
  lifecycleOperationQuery,
  updateOperationFilters,
  type LifecycleOperationFilters,
} from "./lifecycleOperationFilters";
import { LifecycleOperationsPanelActionCard } from "./LifecycleOperationsPanelActionCard";

import {
  formatLifecycleTimestamp,
  type LifecycleAction,
  type LifecycleReconcileAction,
  type LifecycleRecoveryAction,
} from "./LifecycleOperationsPanelShared";

async function submitLifecycleRecovery({
  action,
  refresh,
  showToast,
}: {
  action: LifecycleRecoveryAction;
  refresh: () => Promise<unknown>;
  showToast: (message: string, variant: "success" | "error") => void;
}): Promise<void> {
  try {
    const response = await fetchWithCsrf(
      `/api/admin/account-lifecycle/${action.id}/${action.operation}`,
      { method: "POST" },
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || `Unable to ${action.operation} action`);
    showToast(
      action.operation === "retry" ? "Action queued for retry" : "Action cancelled",
      "success",
    );
    await refresh();
  } catch (error) {
    showToast(
      error instanceof Error ? error.message : "Unable to update action",
      "error",
    );
  }
}

async function submitLifecycleReconciliation({
  action,
  outcome,
  evidence,
  refresh,
  showToast,
}: {
  action: LifecycleReconcileAction;
  outcome: "confirmed_completed" | "confirmed_not_completed";
  evidence: string;
  refresh: () => Promise<unknown>;
  showToast: (message: string, variant: "success" | "error") => void;
}): Promise<boolean> {
  try {
    const response = await fetchWithCsrf(
      `/api/admin/account-lifecycle/${action.id}/reconcile`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outcome, evidence }) },
    );
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to record reconciliation");
    showToast("Reconciliation recorded without replaying the external action", "success");
    await refresh();
    return true;
  } catch (error) {
    showToast(error instanceof Error ? error.message : "Unable to record reconciliation", "error");
    return false;
  }
}


export default function LifecycleOperationsPanel({
  refreshVersion = 0,
}: {
  refreshVersion?: number;
}) {
  const [view, setView] = useState(INITIAL_OPERATION_VIEW);
  const [searchInput, setSearchInput] = useState("");
  const [live, setLive] = useState(true);
  const { filters } = view;
  const queryString = lifecycleOperationQuery(view);
  const hasFilters =
    Boolean(searchInput) ||
    Object.entries(DEFAULT_OPERATION_FILTERS).some(
      ([key, value]) =>
        filters[key as keyof LifecycleOperationFilters] !== value,
    );
  const updateFilters = (update: Partial<LifecycleOperationFilters>) =>
    setView((current) => updateOperationFilters(current, update));
  const resetFilters = () => {
    setSearchInput("");
    setView(INITIAL_OPERATION_VIEW);
  };

  useEffect(() => {
    if (searchInput === filters.search) return;
    const timeout = window.setTimeout(() => {
      setView((current) =>
        updateOperationFilters(current, { search: searchInput }),
      );
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput, filters.search]);

  return (
    <section className="space-y-4" aria-labelledby="lifecycle-actions-heading">
      <div>
        <h3 id="lifecycle-actions-heading" className="font-semibold">
          Lifecycle actions
        </h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Find account changes, inspect their history, and resolve failed or
          uncertain outcomes.
        </p>
      </div>
      <div className="flex flex-wrap gap-1" aria-label="Common operation filters">
        {[
          ["all", "All operations"], ["reconciliation_required", "Needs reconciliation"],
          ["failed", "Failed"], ["queued", "Queued"], ["completed", "Completed"],
        ].map(([status, label]) => <Button key={status} size="sm" variant={filters.status === status ? "secondary" : "ghost"}
          aria-pressed={filters.status === status} onClick={() => updateFilters({ status })}>{label}</Button>)}
      </div>
      <search
        className="space-y-3 rounded-lg border bg-card p-4"
        aria-label="Filter lifecycle actions"
      >
        <div className="space-y-1.5">
          <Label htmlFor="lifecycle-action-search">Search actions</Label>
          <div className="relative">
            <Search
              aria-hidden="true"
              className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
            />
            <Input
              id="lifecycle-action-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              className="pl-9"
              placeholder="Name, username, operator, reason, or reference"
            />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[1.4fr_1.4fr_1fr_1fr_auto] xl:items-end">
          {(
            [
              [
                "actionType",
                "Action type",
                "All actions",
                Object.entries(LIFECYCLE_ACTION_LABELS).filter(
                  ([value]) => value !== "add_to_group",
                ),
              ],
              [
                "status",
                "Status",
                "All statuses",
                Object.entries(LIFECYCLE_STATUS_LABELS),
              ],
              [
                "accountType",
                "Account scope",
                "All scopes",
                Object.entries(LIFECYCLE_SCOPE_LABELS),
              ],
              ["order", "Sort by", null, Object.entries(LIFECYCLE_SORT_LABELS)],
            ] as const
          ).map(([key, label, allLabel, options]) => (
            <div key={key} className="min-w-0 space-y-1.5">
              <Label htmlFor={`lifecycle-filter-${key}`}>{label}</Label>
              <Select
                value={filters[key]}
                onValueChange={(value) => updateFilters({ [key]: value })}
              >
                <SelectTrigger
                  id={`lifecycle-filter-${key}`}
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {allLabel && <SelectItem value="all">{allLabel}</SelectItem>}
                  {options.map(([value, name]) => (
                    <SelectItem key={value} value={value}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          <Button variant="ghost" disabled={!hasFilters} onClick={resetFilters}>
            Clear filters
          </Button>
        </div>
      </search>
      {/* Isolate each collection request: late responses from a previous filter
          or cursor cannot replace the currently selected results. */}
      <LifecycleActionResults
        key={queryString}
        queryString={queryString}
        currentPage={view.cursors.length + 1}
        refreshVersion={refreshVersion}
        live={live}
        onLiveChange={setLive}
        hasFilters={hasFilters}
        onResetFilters={resetFilters}
        onPrevious={() =>
          setView((current) => ({
            ...current,
            cursors: current.cursors.slice(0, -1),
          }))
        }
        onNext={(cursor) =>
          setView((current) => ({
            ...current,
            cursors: [...current.cursors, cursor],
          }))
        }
      />
    </section>
  );
}

function LifecycleActionResults({
  queryString,
  currentPage,
  refreshVersion,
  live,
  onLiveChange,
  hasFilters,
  onResetFilters,
  onPrevious,
  onNext,
}: {
  queryString: string;
  currentPage: number;
  refreshVersion: number;
  live: boolean;
  onLiveChange: (live: boolean) => void;
  hasFilters: boolean;
  onResetFilters: () => void;
  onPrevious: () => void;
  onNext: (cursor: string) => void;
}) {
  const { showToast } = useToast();
  const [actions, setActions] = useState<LifecycleAction[]>([]);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [recoveryAction, setRecoveryAction] = useState<LifecycleRecoveryAction | null>(null);
  const [reconcileAction, setReconcileAction] = useState<LifecycleReconcileAction | null>(null);
  const [reconcileOutcome, setReconcileOutcome] = useState<
    "confirmed_completed" | "confirmed_not_completed"
  >("confirmed_completed");
  const [reconcileEvidence, setReconcileEvidence] = useState("");
  const fetchActions = useCallback(async () => {
    const response = await fetchWithCsrf(
      `/api/admin/account-lifecycle?${queryString}`,
    );
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error || "Unable to load lifecycle operations");
    return data;
  }, [queryString]);

  const { isLoading, isPolling, togglePolling, refresh, lastUpdated, error } =
    usePolling(fetchActions, {
      enabled: live,
      onSuccess: (data) => {
        setActions(data.items || []);
        setTotal(data.pageInfo?.total || 0);
        setNextCursor(data.pageInfo?.nextCursor || null);
      },
      onError: (error) => showToast(error.message, "error"),
    });

  useEffect(() => {
    if (refreshVersion > 0) void refresh();
  }, [refresh, refreshVersion]);

  const performRecovery = async () => {
    if (!recoveryAction) return;
    try {
      await submitLifecycleRecovery({ action: recoveryAction, refresh, showToast });
    } finally {
      setRecoveryAction(null);
    }
  };

  const reconcile = async () => {
    if (!reconcileAction || reconcileEvidence.trim().length < 10) return;
    const recorded = await submitLifecycleReconciliation({
      action: reconcileAction,
      outcome: reconcileOutcome,
      evidence: reconcileEvidence.trim(),
      refresh,
      showToast,
    });
    if (recorded) {
      setReconcileAction(null);
      setReconcileEvidence("");
    }
  };

  const toggleExpanded = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return <LifecycleActionResultsView
    actions={actions} total={total} expanded={expanded} nextCursor={nextCursor}
    isLoading={isLoading} isPolling={isPolling} lastUpdated={lastUpdated} error={error}
    currentPage={currentPage} hasFilters={hasFilters}
    onLiveChange={onLiveChange} onTogglePolling={togglePolling} onRefresh={refresh}
    onResetFilters={onResetFilters} onPrevious={onPrevious} onNext={onNext}
    onToggleExpanded={toggleExpanded} onRecover={setRecoveryAction} onReconcile={setReconcileAction}
    recoveryAction={recoveryAction} reconcileAction={reconcileAction}
    reconcileOutcome={reconcileOutcome} reconcileEvidence={reconcileEvidence}
    onCloseRecovery={() => setRecoveryAction(null)} onCloseReconcile={() => setReconcileAction(null)}
    onChangeOutcome={setReconcileOutcome} onChangeEvidence={setReconcileEvidence}
    onSubmitRecovery={performRecovery} onSubmitReconciliation={reconcile}
  />;
}


type LifecycleActionResultsViewProps = {
  actions: LifecycleAction[]; total: number; expanded: Set<string>; nextCursor: string | null;
  isLoading: boolean; isPolling: boolean; lastUpdated: Date | null; error: Error | null;
  currentPage: number; hasFilters: boolean;
  onLiveChange: (live: boolean) => void; onTogglePolling: () => void; onRefresh: () => Promise<unknown>;
  onResetFilters: () => void; onPrevious: () => void; onNext: (cursor: string) => void;
  onToggleExpanded: (id: string) => void; onRecover: (action: LifecycleRecoveryAction) => void; onReconcile: (action: LifecycleReconcileAction) => void;
  recoveryAction: LifecycleRecoveryAction | null; reconcileAction: LifecycleReconcileAction | null;
  reconcileOutcome: "confirmed_completed" | "confirmed_not_completed"; reconcileEvidence: string;
  onCloseRecovery: () => void; onCloseReconcile: () => void;
  onChangeOutcome: (value: "confirmed_completed" | "confirmed_not_completed") => void; onChangeEvidence: (value: string) => void;
  onSubmitRecovery: () => Promise<void>; onSubmitReconciliation: () => Promise<void>;
};

function LifecycleActionResultsStatus({ isLoading, lastUpdated, error, total, currentPage, isPolling, onLiveChange, onTogglePolling, onRefresh }: Pick<LifecycleActionResultsViewProps, "isLoading" | "lastUpdated" | "error" | "total" | "currentPage" | "isPolling" | "onLiveChange" | "onTogglePolling" | "onRefresh">) {
  const message = isLoading && !lastUpdated ? "Loading actions…" : error && !lastUpdated ? "Actions unavailable" : `${total} matching action${total === 1 ? "" : "s"} · Page ${currentPage}`;
  return <><div className="flex flex-wrap items-center justify-between gap-3"><p role="status" aria-live="polite" className="text-sm text-muted-foreground">{message}</p><div className="flex items-center gap-2"><Button variant="outline" size="sm" aria-label="Live updates" aria-pressed={isPolling} onClick={() => { onLiveChange(!isPolling); onTogglePolling(); }}><span className={cn("h-2 w-2 rounded-full bg-muted-foreground", isPolling && "bg-emerald-500")} /> {isPolling ? "Live" : "Paused"}</Button><Button variant="outline" size="sm" onClick={() => void onRefresh()} disabled={isLoading}><RefreshCw className={cn("h-4 w-4", isLoading && "animate-spin")} /> Refresh</Button></div></div>{lastUpdated && <p className="text-right text-xs text-muted-foreground">Updated {formatLifecycleTimestamp(lastUpdated)} UTC</p>}{error && <p role="alert" className="rounded-md border border-destructive/30 p-3 text-sm text-destructive">{error.message} Use Refresh to try again.{lastUpdated ? " Showing the last loaded actions." : ""}</p>}</>;
}

function LifecycleActionResultsBody({ actions, isLoading, error, hasFilters, onResetFilters, expanded, onToggleExpanded, onRecover, onReconcile }: Pick<LifecycleActionResultsViewProps, "actions" | "isLoading" | "error" | "hasFilters" | "onResetFilters" | "expanded" | "onToggleExpanded" | "onRecover" | "onReconcile">) {
  if (isLoading && actions.length === 0) return <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Loading actions…</div>;
  if (actions.length === 0) return error ? null : <Card><CardContent className="space-y-3 py-14 text-center text-muted-foreground"><p>{hasFilters ? "No lifecycle actions match these filters." : "No lifecycle actions have been recorded yet."}</p>{hasFilters && <Button variant="outline" onClick={onResetFilters}>Clear filters</Button>}</CardContent></Card>;
  return <div className="overflow-hidden rounded-lg border bg-card"><Table><TableHeader className="bg-muted/40"><TableRow><TableHead>Account</TableHead><TableHead>Operation</TableHead><TableHead>Status</TableHead><TableHead>Requested by</TableHead><TableHead>When</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader><TableBody>{actions.map((action) => <LifecycleOperationsPanelActionCard key={action.id} action={action} expanded={expanded.has(action.id)} onToggleExpanded={onToggleExpanded} onRecover={onRecover} onReconcile={onReconcile} />)}</TableBody></Table></div>;
}

function LifecycleActionResultsPager({ currentPage, nextCursor, isLoading, onPrevious, onNext }: Pick<LifecycleActionResultsViewProps, "currentPage" | "nextCursor" | "isLoading" | "onPrevious" | "onNext">) {
  if (currentPage === 1 && !nextCursor) return null;
  return <div className="flex items-center justify-center gap-3"><Button variant="outline" size="sm" disabled={currentPage === 1 || isLoading} onClick={onPrevious}>Previous</Button><span className="text-sm text-muted-foreground">Page {currentPage}</span><Button variant="outline" size="sm" disabled={!nextCursor || isLoading} onClick={() => { if (nextCursor) onNext(nextCursor); }}>Next</Button></div>;
}

function LifecycleActionResultsView(props: LifecycleActionResultsViewProps) {
  return <div className="space-y-4">
    <LifecycleActionResultsStatus {...props} />
    <LifecycleActionResultsBody {...props} />
    <LifecycleActionResultsPager {...props} />
    <LifecycleActionDialogs
      recoveryAction={props.recoveryAction}
      reconcileAction={props.reconcileAction}
      reconcileOutcome={props.reconcileOutcome}
      reconcileEvidence={props.reconcileEvidence}
      onCloseRecovery={props.onCloseRecovery}
      onCloseReconcile={props.onCloseReconcile}
      onChangeOutcome={props.onChangeOutcome}
      onChangeEvidence={props.onChangeEvidence}
      onRecover={props.onSubmitRecovery}
      onReconcile={props.onSubmitReconciliation}
    />
  </div>;
}

function LifecycleActionDialogs({
  recoveryAction, reconcileAction, reconcileOutcome, reconcileEvidence,
  onCloseRecovery, onCloseReconcile, onChangeOutcome, onChangeEvidence, onRecover, onReconcile,
}: {
  recoveryAction: { id: string; username: string; operation: "retry" | "cancel" } | null;
  reconcileAction: { id: string; username: string } | null;
  reconcileOutcome: "confirmed_completed" | "confirmed_not_completed";
  reconcileEvidence: string;
  onCloseRecovery: () => void;
  onCloseReconcile: () => void;
  onChangeOutcome: (value: "confirmed_completed" | "confirmed_not_completed") => void;
  onChangeEvidence: (value: string) => void;
  onRecover: () => Promise<void>;
  onReconcile: () => Promise<void>;
}) {
  return <><AlertDialog open={Boolean(recoveryAction)} onOpenChange={(open) => !open && onCloseRecovery()}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{recoveryAction?.operation === "retry" ? "Retry failed action?" : "Cancel queued action?"}</AlertDialogTitle><AlertDialogDescription>{recoveryAction?.operation === "retry" ? `Queue another controlled attempt for ${recoveryAction?.username}.` : `Prevent the queued action for ${recoveryAction?.username} from starting. History remains available.`}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep current state</AlertDialogCancel><AlertDialogAction onClick={() => void onRecover()}>{recoveryAction?.operation === "retry" ? "Queue retry" : "Cancel action"}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog><Dialog open={Boolean(reconcileAction)} onOpenChange={(open) => !open && onCloseReconcile()}><DialogContent><DialogHeader><DialogTitle>Reconcile uncertain outcome</DialogTitle><DialogDescription>Record the external AD/VPN state observed for {reconcileAction?.username}. This does not replay the action.</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label>Observed outcome</Label><Select value={reconcileOutcome} onValueChange={(value) => onChangeOutcome(value as typeof reconcileOutcome)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="confirmed_completed">External action completed</SelectItem><SelectItem value="confirmed_not_completed">External action did not complete</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="reconcile-evidence">External evidence</Label><Textarea id="reconcile-evidence" value={reconcileEvidence} onChange={(event) => onChangeEvidence(event.target.value)} placeholder="Observation, timestamp, and source" /></div></div><DialogFooter><Button variant="outline" onClick={onCloseReconcile}>Cancel</Button><Button disabled={reconcileEvidence.trim().length < 10} onClick={() => void onReconcile()}>Record reconciliation</Button></DialogFooter></DialogContent></Dialog></>;
}
