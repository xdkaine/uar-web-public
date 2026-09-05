import { DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Check, Link, AlertTriangle } from "lucide-react";
import type { VPNImport } from "./vpnADMatchTypes";

export default function VPNMatchHeader({
  importData,
}: {
  importData: VPNImport;
}) {
  return (
    <DialogHeader>
      <div className="flex justify-between items-start mr-8">
        <div className="flex-1">
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Link className="w-5 h-5" />
            Match VPN Users to Active Directory
          </DialogTitle>
          <div className="text-sm text-muted-foreground mt-1 flex flex-col gap-1">
            <span>
              {importData.fileName} -{" "}
              <span className="font-medium">
                {importData.portalType} Portal
              </span>
            </span>
            <div className="flex gap-4 mt-2 text-sm">
              <span className="font-semibold text-muted-foreground">
                Total: {importData.totalRecords}
              </span>
              <span className="text-green-600 dark:text-green-400 font-semibold flex items-center gap-1">
                <Check className="w-3 h-3" /> Matched:{" "}
                {importData.matchedRecords}
              </span>
              <span className="text-yellow-600 dark:text-yellow-400 font-semibold flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" /> Unmatched:{" "}
                {importData.totalRecords - importData.matchedRecords}
              </span>
            </div>
          </div>

          <div className="mt-3 max-w-md">
            <div className="flex items-center justify-between text-xs mb-1">
              <span>Progress</span>
              <span>
                {Math.round(
                  (importData.matchedRecords / importData.totalRecords) * 100,
                )}
                %
              </span>
            </div>
            <div className="w-full bg-secondary rounded-full h-2 overflow-hidden">
              <div
                className="bg-green-600 h-full w-full origin-left transition-transform duration-300 ease-in-out"
                style={{
                  transform: `scaleX(${importData.matchedRecords / importData.totalRecords})`,
                }}
              ></div>
            </div>
          </div>

          {importData.matchedRecords === 0 && (
            <div className="mt-3 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded p-2 text-xs text-blue-800 inline-block">
              💡 <strong>Tip:</strong> Click &quot;Match&quot; next to a VPN
              username, then search for the corresponding AD account.
            </div>
          )}
        </div>
      </div>
    </DialogHeader>
  );
}
