import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Database,
  Eye,
  Info,
  Play,
  RotateCw,
} from "lucide-react";
import { ClientLocalDate } from "./ClientLocalDate";
import type {
  InfrastructureSyncResult,
  InfrastructureSyncStatus,
} from "./infrastructureSyncClient";

export function InfrastructureSyncIntroduction() {
  return (
    <Alert className="border-purple-200 bg-gradient-to-r from-purple-50 to-blue-50 dark:border-purple-900 dark:from-purple-950/50 dark:to-blue-950/40">
      <Database className="h-5 w-5 text-purple-600 dark:text-purple-400" />
      <AlertDescription>
        <div className="mt-1 space-y-2 text-sm text-purple-900 dark:text-purple-100">
          <p className="font-semibold">
            Automatically sync existing Active Directory accounts into the
            application database.
          </p>
          <div className="space-y-1 rounded-lg border border-purple-100 bg-white/50 p-3 text-xs dark:border-purple-900 dark:bg-black/20">
            <p className="font-medium">Sync Operations:</p>
            <ul className="list-disc list-inside space-y-0.5 ml-1">
              <li>Find all AD accounts with @cpp.edu emails</li>
              <li>Create AccessRequest records (status: approved)</li>
              <li>Create VPNAccount records in the Limited portal</li>
              <li>Link records and skip duplicates</li>
            </ul>
          </div>
          <p className="text-xs text-purple-600 dark:text-purple-400 italic flex items-center gap-1">
            <Info className="w-3 h-3" /> Tip: Run a dry run first to preview
            changes
          </p>
        </div>
      </AlertDescription>
    </Alert>
  );
}

export function InfrastructureSyncControls({
  isRunning,
  onRun,
  onRefresh,
}: {
  isRunning: boolean;
  onRun: (dryRun: boolean) => void;
  onRefresh: () => void;
}) {
  return (
    <div className="flex gap-3 flex-wrap">
      <Button
        onClick={() => onRun(false)}
        disabled={isRunning}
        className="bg-purple-600 hover:bg-purple-700 text-white gap-2 shadow-sm"
      >
        {isRunning ? (
          <RotateCw className="w-4 h-4 animate-spin" />
        ) : (
          <Play className="w-4 h-4" />
        )}
        {isRunning ? "Running Sync..." : "Run Sync"}
      </Button>
      <Button
        variant="secondary"
        onClick={() => onRun(true)}
        disabled={isRunning}
        className="gap-2"
      >
        {isRunning ? (
          <RotateCw className="w-4 h-4 animate-spin" />
        ) : (
          <Eye className="w-4 h-4" />
        )}
        Dry Run (Preview)
      </Button>
      <Button
        variant="outline"
        onClick={onRefresh}
        disabled={isRunning}
        className="gap-2 border-purple-200 dark:border-purple-900 text-purple-700 dark:text-purple-200 hover:bg-purple-50 dark:bg-purple-950/40 hover:text-purple-800"
      >
        <RotateCw className="w-4 h-4" /> Refresh Status
      </Button>
    </div>
  );
}

export function InfrastructureSyncMessage({
  message,
}: {
  message: { type: "success" | "error" | "info"; text: string } | null;
}) {
  if (!message) return null;
  return (
    <Alert
      variant={message.type === "error" ? "destructive" : "default"}
      className={
        message.type === "success"
          ? "bg-green-50 dark:bg-green-950/40 text-green-900 border-green-200 dark:border-green-900"
          : ""
      }
    >
      {message.type === "error" ? (
        <AlertTriangle className="h-4 w-4" />
      ) : (
        <Info className="h-4 w-4" />
      )}
      <AlertDescription className="font-medium">
        {message.text}
      </AlertDescription>
    </Alert>
  );
}

export function InfrastructureSyncStatusCard({
  latestSync,
}: {
  latestSync: InfrastructureSyncStatus | null;
}) {
  if (!latestSync) return null;
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
          Latest Sync Status
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat label="Status">
            <Badge
              variant={
                latestSync.status === "completed"
                  ? "default"
                  : latestSync.status === "failed"
                    ? "destructive"
                    : "secondary"
              }
              className={
                latestSync.status === "completed"
                  ? "bg-green-500 hover:bg-green-600"
                  : ""
              }
            >
              {latestSync.status.toUpperCase()}
            </Badge>
          </Stat>
          <Stat label="AD Accounts">
            <p className="text-2xl font-bold">{latestSync.totalADAccounts}</p>
          </Stat>
          <Stat label="Created">
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {latestSync.autoAssigned}
            </p>
          </Stat>
          <Stat label="Triggered By">
            <p
              className="text-sm font-medium truncate"
              title={latestSync.triggeredBy}
            >
              {latestSync.triggeredBy}
            </p>
          </Stat>
        </div>
        <div className="mt-4 pt-4 border-t text-xs text-muted-foreground grid grid-cols-1 md:grid-cols-2 gap-2">
          <p>
            <b>Started:</b> <ClientLocalDate value={latestSync.startedAt} />
          </p>
          {latestSync.completedAt && (
            <p>
              <b>Completed:</b>{" "}
              <ClientLocalDate value={latestSync.completedAt} />
            </p>
          )}
          {latestSync.notes && (
            <p className="col-span-full">
              <b>Notes:</b> {latestSync.notes}
            </p>
          )}
          {latestSync.errorMessage && (
            <p className="col-span-full text-red-600 dark:text-red-400">
              <b>Error:</b> {latestSync.errorMessage}
            </p>
          )}
        </div>
        {latestSync.taggingTasks?.length ? (
          <div className="mt-4 space-y-2 border-t pt-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Directory description tasks
            </p>
            {latestSync.taggingTasks.map((task) => (
              <div
                key={task.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-md border p-3 text-sm"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{task.adUsername}</span>
                    <Badge
                      variant={
                        task.status === "completed"
                          ? "default"
                          : task.status === "reconciliation_required"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {task.status.replaceAll("_", " ")}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Request {task.accessRequestId} · attempt {task.attempts}
                  </p>
                  {task.lastError && (
                    <p className="mt-1 text-xs text-destructive">
                      {task.lastError}
                    </p>
                  )}
                </div>
                {[
                  "failed",
                  "reconciliation_required",
                  "pending",
                  "processing",
                ].includes(task.status) && (
                  <span className="text-xs text-muted-foreground">
                    Legacy metadata task retained as evidence; LDAP retry
                    retired.
                  </span>
                )}
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
function Stat({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <span className="text-xs text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function actionBadge(action: string) {
  if (action === "created")
    return (
      <Badge className="bg-green-100 dark:bg-green-950/60 text-green-800">
        <CheckCircle2 className="w-3 h-3 mr-1" /> Created
      </Badge>
    );
  if (action === "error")
    return (
      <Badge variant="destructive">
        <AlertTriangle className="w-3 h-3 mr-1" /> Error
      </Badge>
    );
  return (
    <Badge variant="secondary">
      {action === "skipped_duplicate" ? "Skipped" : action}
    </Badge>
  );
}
export function InfrastructureSyncResults({
  result,
  showDetails,
  onToggleDetails,
}: {
  result: InfrastructureSyncResult | null;
  showDetails: boolean;
  onToggleDetails: () => void;
}) {
  if (!result?.records.length) return null;
  const counts = { created: 0, skipped: 0, error: 0 };
  for (const record of result.records) {
    if (record.action === "created") counts.created += 1;
    else if (record.action === "skipped_duplicate") counts.skipped += 1;
    else counts.error += 1;
  }
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-4">
        <div className="flex items-center gap-2">
          <ClipboardList className="w-5 h-5 text-muted-foreground" />
          <CardTitle className="text-base">
            Sync Results ({result.records.length} accounts)
          </CardTitle>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleDetails}
          className="text-purple-600 dark:text-purple-400"
        >
          {showDetails ? (
            <ChevronDown className="w-4 h-4 mr-1" />
          ) : (
            <ChevronRight className="w-4 h-4 mr-1" />
          )}
          {showDetails ? "Hide Details" : "Show Details"}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <Metric label="Created" value={counts.created} />
          <Metric label="Skipped" value={counts.skipped} />
          <Metric label="Errors" value={counts.error} />
          <Metric label="Total" value={result.records.length} />
        </div>
        {showDetails && (
          <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
            {result.records.map((record) => (
              <div
                key={
                  record.accessRequestId ??
                  record.vpnAccountId ??
                  record.adUsername
                }
                className="flex items-start justify-between p-3 rounded-lg border bg-muted/30"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">
                      {record.adDisplayName}
                    </span>
                    {actionBadge(record.action)}
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <p>
                      {record.adUsername} • {record.adEmail}
                    </p>
                    {record.accessRequestId && (
                      <p>
                        Request ID:{" "}
                        <span className="font-mono">
                          {record.accessRequestId}
                        </span>
                      </p>
                    )}
                    {record.vpnAccountId && (
                      <p>
                        VPN ID:{" "}
                        <span className="font-mono">{record.vpnAccountId}</span>
                      </p>
                    )}
                    {record.errorMessage && (
                      <p className="text-red-500 font-medium">
                        {record.errorMessage}
                      </p>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-muted/50 p-3 rounded-lg border flex flex-col items-center">
      <span className="text-xs font-semibold uppercase">{label}</span>
      <span className="text-xl font-bold">{value}</span>
    </div>
  );
}

export function InfrastructureSyncNotes() {
  return (
    <Alert className="bg-yellow-50 dark:bg-yellow-950/40 border-yellow-200 dark:border-yellow-900">
      <Info className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
      <AlertTitle className="text-yellow-800">Important Notes</AlertTitle>
      <AlertDescription className="text-yellow-700 dark:text-yellow-200 text-xs mt-1">
        <ul className="list-disc list-inside space-y-0.5">
          <li>
            <b>Duplicate Prevention:</b> Existing accounts are automatically
            skipped
          </li>
          <li>
            <b>Limited Portal:</b> Synced VPN accounts default to the Limited
            portal group
          </li>
          <li>
            <b>Auto-Approved:</b> AccessRequests are auto-approved for existing
            AD accounts
          </li>
          <li>
            <b>Database safety:</b> Portal database writes use one transaction.
            Directory reads and post-commit description updates are external
            operations with separate outcomes.
          </li>
        </ul>
      </AlertDescription>
    </Alert>
  );
}
