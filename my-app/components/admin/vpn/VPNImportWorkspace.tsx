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
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Plus, Trash2, UserPlus } from "lucide-react";
import VPNImportModal from "../VPNImportModal";
import VPNADMatchModal from "../VPNADMatchModal";
import { VPNImportQueueDialog } from "./VPNImportQueueDialog";
import type { useVPNImports } from "./useVPNImports";

interface VPNImportWorkspaceProps {
  imports: ReturnType<typeof useVPNImports>;
}
export function VPNImportWorkspace({ imports }: VPNImportWorkspaceProps) {
  return (
    <>
      <Card className="bg-purple-50 dark:bg-purple-950/40 border-purple-200 dark:border-purple-900">
        <CardContent className="p-6">
          <h3 className="text-lg font-bold text-purple-900 mb-3">
            Import VPN Users from Spreadsheet
          </h3>
          <p className="text-sm text-purple-800 mb-4">
            Import existing VPN users from a spreadsheet to manually match them
            with Active Directory accounts (for Internal users) or directly
            create accounts (for External users). This helps identify who is on
            your infrastructure.
          </p>
          <div className="space-y-3">
            <div className="relative inline-block">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button className="bg-purple-600 hover:bg-purple-700 text-white gap-2">
                    <Plus className="w-5 h-5" />
                    Import VPN Users
                    <ChevronDown className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64" align="start">
                  <DropdownMenuLabel className="text-xs font-bold text-muted-foreground uppercase">
                    Internal Users
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => imports.openImport("Internal", "Management")}
                    className="cursor-pointer"
                  >
                    <span className="w-3 h-3 bg-blue-600 rounded-full mr-2"></span>
                    Management Portal
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => imports.openImport("Internal", "Limited")}
                    className="cursor-pointer"
                  >
                    <span className="w-3 h-3 bg-purple-600 rounded-full mr-2"></span>
                    Limited Portal
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-xs font-bold text-muted-foreground uppercase">
                    External Users
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => imports.openImport("External")}
                    className="cursor-pointer"
                  >
                    <span className="w-3 h-3 bg-orange-600 rounded-full mr-2"></span>
                    External Users
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="flex justify-between items-center pt-2 border-t border-purple-300">
              <Button
                variant="destructive"
                onClick={() => imports.setShowClearQueueConfirm(true)}
                className="gap-2"
              >
                <Trash2 className="w-5 h-5" />
                Clear Queue
              </Button>
              <Button
                variant="default"
                onClick={imports.openQueue}
                className="bg-secondary hover:bg-foreground/90 gap-2"
              >
                <UserPlus className="w-5 h-5" />
                View Import Queue
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      {imports.showImportModal && (
        <VPNImportModal
          userType={imports.importUserType}
          portalType={imports.importPortalType}
          onClose={() => imports.setShowImportModal(false)}
          onImportComplete={() => {
            imports.setShowImportModal(false);
            imports.onRefresh();
          }}
        />
      )}
      <VPNImportQueueDialog
        open={imports.showImportQueueModal}
        imports={imports.imports}
        isProcessing={imports.isProcessingImport}
        onOpenChange={imports.setShowImportQueueModal}
        onMatch={imports.openMatch}
        onProcess={imports.processImport}
        onCleanup={imports.cleanupExpired}
      />
      {imports.showMatchModal && imports.selectedImportId && (
        <VPNADMatchModal
          importId={imports.selectedImportId}
          onClose={imports.closeMatch}
          onComplete={() => {
            imports.closeMatch();
            imports.onRefresh();
          }}
        />
      )}
      <AlertDialog
        open={imports.showClearQueueConfirm}
        onOpenChange={imports.setShowClearQueueConfirm}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear Import Queue?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to clear all imports from the queue? This
              action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={imports.confirmClearQueue}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Clear Queue
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
