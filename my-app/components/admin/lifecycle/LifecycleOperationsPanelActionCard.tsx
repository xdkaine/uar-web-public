import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  RotateCcw,
} from "lucide-react";

import { AccountName } from "../AccountName";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  LIFECYCLE_ACTION_LABELS,
  LIFECYCLE_STATUS_LABELS,
} from "./lifecycleOperationFilters";
import {
  formatLifecycleTimestamp,
  lifecycleStatusClass,
  needsFreshDirectoryDeletionReview,
  type LifecycleAction,
  type LifecycleReconcileAction,
  type LifecycleRecoveryAction,
} from "./LifecycleOperationsPanelShared";

interface LifecycleOperationsPanelActionCardProps {
  action: LifecycleAction;
  expanded: boolean;
  onToggleExpanded: (id: string) => void;
  onRecover: (action: LifecycleRecoveryAction) => void;
  onReconcile: (action: LifecycleReconcileAction) => void;
}

function LifecycleOperationsPanelActionEvidence({ action }: { action: LifecycleAction }) {
  return <div className="mt-4 grid gap-4 border-t pt-4 md:grid-cols-2"><div className="space-y-3"><div className="rounded-md border bg-muted/20 p-3 text-sm"><dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-2"><dt className="text-muted-foreground">Account scope</dt><dd>{action.targetAccountType}</dd><dt className="text-muted-foreground">Request</dt><dd className="break-all font-mono text-xs">{action.relatedRequestId || "None"}</dd><dt className="text-muted-foreground">Reviewed plan</dt><dd className="break-all font-mono text-xs">{action.batchId || "None"}</dd><dt className="text-muted-foreground">Reference</dt><dd>{action.relatedTicketId || "None"}</dd>{action.operationMode === "directory_override" && <><dt className="text-muted-foreground">Override reason</dt><dd>{action.bindingFailureCode || "Not recorded"}</dd>{action.policyVersion && <><dt className="text-muted-foreground">Recorded rule version</dt><dd>{action.policyVersion}</dd></>}</>}<dt className="text-muted-foreground">Notes</dt><dd className="whitespace-pre-wrap">{action.notes || "None"}</dd></dl>{action.errorMessage && <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">{action.errorMessage}</div>}</div>{(action.preflightSnapshot || action.resultSnapshot || action.authorizationEvidence) && <div className="rounded-md border p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{action.operationMode === "directory_override" ? "Override evidence" : "Execution evidence"}</p>{action.targetDirectoryDn && <p className="mt-2 break-all font-mono text-xs">{action.targetDirectoryDn}</p>}<pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words text-[11px] text-muted-foreground">{JSON.stringify({ confirmation: action.authorizationEvidence, before: action.preflightSnapshot, result: action.resultSnapshot }, null, 2)}</pre></div>}</div><div className="max-h-80 space-y-2 overflow-y-auto rounded-md border p-3"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recent history · {action.historyTotal ?? action.history.length} events</p>{action.history.map((event) => <div key={event.id} className="border-l-2 pl-3 text-sm"><div className="flex justify-between gap-2"><span className="font-medium">{event.event}</span><span className="text-xs text-muted-foreground">{formatLifecycleTimestamp(event.createdAt)} UTC</span></div>{event.performedBy && <p className="text-xs text-muted-foreground">By <AccountName username={event.performedBy} displayName={event.performedByDisplayName} className="text-xs" /></p>}{event.details && <p className="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground">{event.details}</p>}</div>)}</div></div>;
}

function LifecycleOperationsPanelActionControls({ action, expanded, onToggleExpanded, onRecover, onReconcile }: LifecycleOperationsPanelActionCardProps) {
  const freshReview = needsFreshDirectoryDeletionReview(action);
  const retry = action.canRetry && action.status === "failed" && action.actionType !== "delete_vpn_record" && !freshReview;
  const cancel = action.canCancel && ["queued", "pending"].includes(action.status);
  const reconcile = action.canReconcile && action.status === "reconciliation_required";
  return <TableCell className="align-top py-2 text-right"><div className="flex items-center justify-end gap-1">{retry && <Button variant="ghost" size="sm" onClick={() => onRecover({ id: action.id, username: action.targetUsername, operation: "retry" })}><RotateCcw aria-hidden="true" className="h-4 w-4" />Retry</Button>}{freshReview && action.status === "failed" && <span className="max-w-40 text-xs text-amber-700 dark:text-amber-300">Refresh account state and review deletion again.</span>}{cancel && <Button variant="ghost" size="sm" onClick={() => onRecover({ id: action.id, username: action.targetUsername, operation: "cancel" })}>Cancel</Button>}{reconcile && <Button variant="outline" size="sm" onClick={() => onReconcile({ id: action.id, username: action.targetUsername })}><AlertTriangle aria-hidden="true" className="h-4 w-4" />Reconcile</Button>}<Button variant="ghost" size="icon" aria-expanded={expanded} aria-controls={`operation-evidence-${action.id}`} aria-label={`${expanded ? "Hide" : "View"} evidence for ${action.targetDisplayName || action.targetUsername}`} onClick={() => onToggleExpanded(action.id)}>{expanded ? <ChevronUp aria-hidden="true" className="h-4 w-4" /> : <ChevronDown aria-hidden="true" className="h-4 w-4" />}</Button></div></TableCell>;
}

export function LifecycleOperationsPanelActionCard({ action, expanded, onToggleExpanded, onRecover, onReconcile }: LifecycleOperationsPanelActionCardProps) {
  const accountType = action.targetAccountType === "BOTH" ? "AD + VPN" : action.targetAccountType;
  const actionLabel = LIFECYCLE_ACTION_LABELS[action.actionType] || action.actionType;
  const statusLabel = LIFECYCLE_STATUS_LABELS[action.status] || action.status.replaceAll("_", " ");
  return <><TableRow><TableCell className="min-w-40 align-top py-3"><AccountName username={action.targetUsername} displayName={action.targetDisplayName} /><span className="mt-1 block text-xs text-muted-foreground">{accountType}</span></TableCell><TableCell className="min-w-48 max-w-72 align-top py-3"><span className="block text-sm font-medium">{actionLabel}</span><span className="mt-1 block truncate text-xs text-muted-foreground" title={action.reason}>{action.reason}</span>{action.operationMode === "directory_override" && <span className="text-xs text-muted-foreground">Unmanaged directory</span>}</TableCell><TableCell className="align-top py-3"><Badge variant="outline" className={cn("whitespace-nowrap", lifecycleStatusClass(action.status))}>{statusLabel}</Badge></TableCell><TableCell className="min-w-36 align-top py-3"><AccountName username={action.requestedBy} displayName={action.requestedByDisplayName} className="text-sm" /></TableCell><TableCell className="align-top py-3 text-xs text-muted-foreground whitespace-nowrap"><time dateTime={action.createdAt}>{formatLifecycleTimestamp(action.createdAt)}</time><span className="block">UTC</span></TableCell><LifecycleOperationsPanelActionControls action={action} expanded={expanded} onToggleExpanded={onToggleExpanded} onRecover={onRecover} onReconcile={onReconcile} /></TableRow>{expanded && <TableRow id={`operation-evidence-${action.id}`} className="bg-muted/20 hover:bg-muted/20"><TableCell colSpan={6} className="px-4 pb-4"><LifecycleOperationsPanelActionEvidence action={action} /></TableCell></TableRow>}</>;
}
