import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, RotateCcw, Save, ShieldAlert } from "lucide-react";

type DirectoryEmailOverviewSaveViewProps = {
  savedHereCount: number;
  environmentCount: number;
  defaultsCount: number;
  legacyFallbackKeys: string[];
  message: { type: "success" | "error"; text: string } | null;
  reason: string;
  hasChanges: boolean;
  saving: boolean;
  onReasonChange: (value: string) => void;
  onSave: () => void;
};

function SummaryChip({ count, label }: { count: number; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs">
      <span className="font-semibold">{count}</span>
      <span className="text-muted-foreground">{label}</span>
    </span>
  );
}

export default function DirectoryEmailOverviewSaveView({
  savedHereCount,
  environmentCount,
  defaultsCount,
  legacyFallbackKeys,
  message,
}: Pick<
  DirectoryEmailOverviewSaveViewProps,
  | "savedHereCount"
  | "environmentCount"
  | "defaultsCount"
  | "legacyFallbackKeys"
  | "message"
>) {
  return (
    <>
      {message && (
        <Alert variant={message.type === "error" ? "destructive" : "default"}>
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      )}
      <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
        <p className="max-w-4xl text-sm leading-relaxed">
          Saved values are authoritative. Environment values are used only
          when no database row exists for that field.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <SummaryChip count={savedHereCount} label="saved here" />
          <SummaryChip count={environmentCount} label="from environment" />
          <SummaryChip count={defaultsCount} label="using defaults" />
        </div>
      </div>
      {legacyFallbackKeys.length > 0 && (
        <Alert>
          <ShieldAlert className="h-4 w-4" />
          <AlertDescription>
            <span className="font-semibold">{legacyFallbackKeys.length} values have not been saved here.</span>{" "}
            They currently use deployment fallbacks:{" "}
            <span className="font-mono text-xs">
              {legacyFallbackKeys.join(", ")}
            </span>
            . Clearing a saved value later hands control back to the
            environment.
          </AlertDescription>
        </Alert>
      )}
    </>
  );
}

export function DirectoryEmailSaveView({
  reason,
  hasChanges,
  saving,
  onReasonChange,
  onSave,
}: Pick<
  DirectoryEmailOverviewSaveViewProps,
  "reason" | "hasChanges" | "saving" | "onReasonChange" | "onSave"
>) {
  return (
    <>
      <Card>
        <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex-1 space-y-1">
            <Label
              htmlFor="config-change-reason"
              className="text-xs text-muted-foreground"
            >
              Change reason (recorded in configuration history)
            </Label>
            <Input
              id="config-change-reason"
              className="text-sm"
              value={reason}
              placeholder="e.g. Rotating SMTP relay per change request CHG-0142"
              onChange={(event) => onReasonChange(event.target.value)}
            />
          </div>
          <Button onClick={onSave} disabled={saving || !hasChanges}>
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-2" />
            )}
            Save Configuration
          </Button>
        </CardContent>
      </Card>
      <p className="text-xs text-muted-foreground flex items-center gap-1">
        <RotateCcw className="h-3 w-3" /> Clearing a field and saving removes
        its database row; only then can the environment fallback apply.
        Passwords are encrypted and never displayed after saving.
      </p>
    </>
  );
}
