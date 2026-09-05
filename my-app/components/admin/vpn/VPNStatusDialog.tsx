"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  VPNStatusAccountHistory,
  VPNStatusAccountInformation,
} from "./VPNStatusAccountPanels";
import type { VPNAccount } from "./vpnManagementTypes";

interface Props {
  selectedAccount: VPNAccount;
  isOpen: boolean;
  newStatus: string;
  statusReason: string;
  statusBadge: ReactNode;
  portalBadge: ReactNode;
  onStatusChange: (status: string) => void;
  onReasonChange: (reason: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

export default function VPNStatusDialog({
  selectedAccount,
  isOpen,
  newStatus,
  statusReason,
  statusBadge,
  portalBadge,
  onStatusChange,
  onReasonChange,
  onSubmit,
  onClose,
}: Props) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manage VPN Account</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <VPNStatusAccountInformation
            selectedAccount={selectedAccount}
            portalBadge={portalBadge}
            statusBadge={statusBadge}
          />
          <VPNStatusAccountHistory selectedAccount={selectedAccount} />

          <div className="border-t-2 border-border pt-6">
            <h4 className="text-lg font-semibold text-foreground mb-4">
              Update Status
            </h4>
            <div className="space-y-4">
              <div>
                <Label className="mb-2 block">New Status</Label>
                <Select value={newStatus} onValueChange={onStatusChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select status..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="pending_faculty">
                      Pending Faculty
                    </SelectItem>
                    <SelectItem value="disabled">Disabled</SelectItem>
                    <SelectItem value="revoked">Revoked</SelectItem>
                  </SelectContent>
                </Select>
                {newStatus === "revoked" &&
                  selectedAccount.status === "revoked" && (
                    <p className="mt-2 text-sm text-purple-600 dark:text-purple-400">
                      Note: This account is already revoked. Use
                      &quot;Active&quot; to restore it.
                    </p>
                  )}
                {newStatus === "active" &&
                  selectedAccount.status === "revoked" &&
                  selectedAccount.canRestore !== false && (
                    <p className="mt-2 text-sm text-green-600 dark:text-green-400">
                      ✓ This will restore the revoked VPN account.
                    </p>
                  )}
                {selectedAccount.canRestore === false &&
                  newStatus === "active" &&
                  selectedAccount.status === "revoked" && (
                    <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                      ⚠ This account cannot be restored automatically. It may
                      need manual intervention.
                    </p>
                  )}
              </div>

              <div>
                <Label htmlFor="vpn-status-reason" className="mb-2 block">
                  Reason for Change{" "}
                  <span className="text-muted-foreground font-normal">
                    (Optional)
                  </span>
                </Label>
                <textarea
                  id="vpn-status-reason"
                  value={statusReason}
                  onChange={(e) => onReasonChange(e.target.value)}
                  className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  rows={4}
                  placeholder="Enter a reason for this status change..."
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={onSubmit}
            disabled={!newStatus}
            className="bg-primary hover:bg-foreground/90"
          >
            Update Status
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
