import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { VPNImportSummary } from "./vpnImportActions";

interface VPNImportQueueDialogProps {
  open: boolean;
  imports: VPNImportSummary[];
  isProcessing: boolean;
  onOpenChange: (open: boolean) => void;
  onMatch: (id: string) => void;
  onProcess: (id: string) => void;
  onCleanup: () => void;
}
export function VPNImportQueueDialog({
  open,
  imports,
  isProcessing,
  onOpenChange,
  onMatch,
  onProcess,
  onCleanup,
}: VPNImportQueueDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>VPN Import Queue</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {imports.length === 0 ? (
            <div className="text-center text-muted-foreground py-8">
              No imports in queue
            </div>
          ) : (
            <div className="space-y-4">
              {imports.map((imp) => (
                <Card key={imp.id}>
                  <CardContent className="p-4">
                    <div className="flex justify-between items-start">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-foreground">
                            {imp.fileName}
                          </span>
                          <Badge
                            variant={
                              imp.userType === "Internal"
                                ? "default"
                                : "secondary"
                            }
                            className={
                              imp.userType === "Internal"
                                ? "bg-blue-100 dark:bg-blue-950/60 text-blue-800 hover:bg-blue-100 dark:bg-blue-950/60"
                                : "bg-orange-100 dark:bg-orange-950/60 text-orange-800 hover:bg-orange-100 dark:bg-orange-950/60"
                            }
                          >
                            {imp.userType}
                          </Badge>
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          {imp.portalType && (
                            <span className="font-medium">
                              {imp.portalType} Portal
                            </span>
                          )}
                          {imp.portalType && " · "}Imported by {imp.importedBy}
                          {" · "}
                          {new Date(imp.createdAt).toLocaleDateString()}
                        </div>
                        <div className="flex gap-4 mt-2 text-sm">
                          <span>
                            Total:{" "}
                            <span className="font-semibold">
                              {imp.totalRecords || 0}
                            </span>
                          </span>
                          <span className="text-green-600 dark:text-green-400">
                            Matched:{" "}
                            <span className="font-semibold">
                              {imp.matchedRecords || 0}
                            </span>
                          </span>
                          <span className="text-yellow-600 dark:text-yellow-400">
                            Unmatched:{" "}
                            <span className="font-semibold">
                              {imp.unmatchedRecords || 0}
                            </span>
                          </span>
                          <span className="text-purple-600 dark:text-purple-400">
                            Created:{" "}
                            <span className="font-semibold">
                              {imp.createdAccounts || 0}
                            </span>
                          </span>
                        </div>
                        {imp.status && (
                          <div className="mt-2">
                            <Badge
                              variant="outline"
                              className={`${imp.status === "completed" ? "bg-green-100 dark:bg-green-950/60 text-green-800 border-green-200 dark:border-green-900" : ""} ${imp.status === "processing" ? "bg-blue-100 dark:bg-blue-950/60 text-blue-800 border-blue-200 dark:border-blue-900" : ""} ${imp.status === "failed" ? "bg-red-100 dark:bg-red-950/60 text-red-800 border-red-200 dark:border-red-900" : ""} ${!["completed", "processing", "failed"].includes(imp.status) ? "bg-yellow-100 dark:bg-yellow-950/60 text-yellow-800 border-yellow-200 dark:border-yellow-900" : ""}`}
                            >
                              {imp.status}
                            </Badge>
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2">
                        {imp.userType === "Internal" && (
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => onMatch(imp.id)}
                            className="bg-blue-600 hover:bg-blue-700"
                          >
                            Match Users
                          </Button>
                        )}
                        {(imp.matchedRecords ?? 0) > 0 &&
                          (imp.createdAccounts ?? 0) <
                            (imp.matchedRecords ?? 0) && (
                            <Button
                              variant="default"
                              size="sm"
                              onClick={() => onProcess(imp.id)}
                              disabled={isProcessing}
                              className="bg-green-600 hover:bg-green-700"
                            >
                              {isProcessing
                                ? "Processing..."
                                : "Create Accounts"}
                            </Button>
                          )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          <div className="flex justify-between pt-4 border-t border-border">
            <Button variant="destructive" onClick={onCleanup}>
              Cleanup Expired
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
