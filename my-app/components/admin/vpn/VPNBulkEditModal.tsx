"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Check } from "lucide-react";

interface VPNAccount {
  id: string;
  username: string;
  name: string;
  status: string;
  createdByFaculty: boolean;
}

interface VPNBulkEditModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedAccountIds: Set<string>;
  accounts: VPNAccount[];
  bulkNewStatus: string;
  onStatusChange: (status: string) => void;
  bulkReason: string;
  onReasonChange: (reason: string) => void;
  bulkFacultyApproval: boolean;
  onFacultyApprovalChange: (approved: boolean) => void;
  onSubmit: () => void;
  onClearSelection: () => void;
  onRemoveAccount: (id: string) => void;
}

const getStatusBadge = (status: string) => {
  const styles = {
    active:
      "bg-green-100 dark:bg-green-950/60 text-green-800 border-green-300 hover:bg-green-100 dark:bg-green-950/60",
    pending_faculty:
      "bg-yellow-100 dark:bg-yellow-950/60 text-yellow-800 border-yellow-300 hover:bg-yellow-100 dark:bg-yellow-950/60",
    disabled:
      "bg-red-100 dark:bg-red-950/60 text-red-800 border-red-300 hover:bg-red-100 dark:bg-red-950/60",
    revoked:
      "bg-purple-100 dark:bg-purple-950/60 text-purple-800 border-purple-300 hover:bg-purple-100 dark:bg-purple-950/60",
  };

  const labels = {
    active: "Active",
    pending_faculty: "Pending Faculty",
    disabled: "Disabled",
    revoked: "Revoked",
  };

  return (
    <Badge
      variant="outline"
      className={
        styles[status as keyof typeof styles] ||
        "bg-muted text-foreground border-border"
      }
    >
      {labels[status as keyof typeof labels] || status}
    </Badge>
  );
};

/**
 * Bulk edit modal for changing status of multiple VPN accounts
 */
export default function VPNBulkEditModal({
  isOpen,
  onClose,
  selectedAccountIds,
  accounts,
  bulkNewStatus,
  onStatusChange,
  bulkReason,
  onReasonChange,
  bulkFacultyApproval,
  onFacultyApprovalChange,
  onSubmit,
  onClearSelection,
  onRemoveAccount,
}: VPNBulkEditModalProps) {
  const handleClose = () => {
    onClose();
    onStatusChange("active");
    onReasonChange("");
    onFacultyApprovalChange(true);
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bulk Edit Status</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <div className="bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 rounded-lg p-4">
            <div className="flex items-center gap-2 text-blue-800 mb-2">
              <Check className="w-5 h-5" />
              <span className="font-semibold">Bulk Update Information</span>
            </div>
            <p className="text-sm text-blue-700 dark:text-blue-200">
              You are about to update{" "}
              <span className="font-bold">{selectedAccountIds.size}</span>{" "}
              account(s). This action will update all selected accounts to the
              chosen status.
            </p>
          </div>

          <div>
            <Label className="mb-2 block">New Status *</Label>
            <Select value={bulkNewStatus} onValueChange={onStatusChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select status..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="pending_faculty">Pending Faculty</SelectItem>
                <SelectItem value="disabled">Disabled</SelectItem>
              </SelectContent>
            </Select>
            <p className="mt-2 text-xs text-muted-foreground">
              {bulkNewStatus === "active" && "Will mark accounts as active"}
              {bulkNewStatus === "pending_faculty" &&
                "Will set accounts to pending faculty approval status"}
              {bulkNewStatus === "disabled" && "Will disable the accounts"}
            </p>
          </div>

          <div className="bg-green-50 dark:bg-green-950/40 border border-green-200 dark:border-green-900 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Checkbox
                id="bulkFacultyApproval"
                checked={bulkFacultyApproval}
                onCheckedChange={(checked) =>
                  onFacultyApprovalChange(checked as boolean)
                }
                className="mt-1"
              />
              <div className="flex-1">
                <Label
                  htmlFor="bulkFacultyApproval"
                  className="text-sm font-semibold text-foreground cursor-pointer flex items-center gap-2"
                >
                  Mark as Faculty Approved
                  <Check className="w-4 h-4 text-green-600 dark:text-green-400" />
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  {bulkFacultyApproval ? (
                    <span className="text-green-700 dark:text-green-200">
                      <strong>Enabled:</strong> Accounts will be marked as
                      created/approved by faculty. This indicates the VPN
                      accounts have been properly provisioned.
                    </span>
                  ) : (
                    <span className="text-yellow-700 dark:text-yellow-200">
                      <strong>Disabled:</strong> Accounts will be marked as not
                      yet faculty approved. Use this if accounts need further
                      review.
                    </span>
                  )}
                </p>
              </div>
            </div>
          </div>

          <div>
            <Label htmlFor="vpn-bulk-status-reason" className="mb-2 block">
              Reason (Optional)
            </Label>
            <textarea
              id="vpn-bulk-status-reason"
              value={bulkReason}
              onChange={(e) => onReasonChange(e.target.value)}
              className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              rows={4}
              placeholder="Enter a reason for this bulk status change..."
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-2">
              <Label>Selected Accounts ({selectedAccountIds.size})</Label>
              <Button
                variant="link"
                className="text-red-600 dark:text-red-400 hover:text-red-800 p-0 h-auto font-medium text-xs"
                onClick={onClearSelection}
              >
                Clear Selection
              </Button>
            </div>
            <div className="max-h-48 overflow-y-auto border border-border rounded-lg p-3 bg-muted/50">
              <div className="space-y-1">
                {Array.from(selectedAccountIds).map((id) => {
                  const account = accounts.find((a) => a.id === id);
                  return account ? (
                    <div
                      key={id}
                      className="text-sm text-muted-foreground flex items-center justify-between py-1"
                    >
                      <span className="flex items-center gap-2">
                        <span className="font-mono font-semibold">
                          {account.username}
                        </span>
                        <span className="text-muted-foreground">-</span>
                        <span>{account.name}</span>
                        <span className="text-muted-foreground">-</span>
                        <span className="text-xs">
                          {getStatusBadge(account.status)}
                        </span>
                        <span className="text-muted-foreground">-</span>
                        {account.createdByFaculty ? (
                          <span className="text-xs text-green-600 dark:text-green-400 font-semibold">
                            ✓ Faculty
                          </span>
                        ) : (
                          <span className="text-xs text-yellow-600 dark:text-yellow-400">
                            ⧗ Pending
                          </span>
                        )}
                      </span>
                      <Button
                        variant="ghost"
                        className="text-red-600 dark:text-red-400 hover:text-red-800 h-6 px-2 text-xs"
                        onClick={() => onRemoveAccount(id)}
                      >
                        Remove
                      </Button>
                    </div>
                  ) : null;
                })}
              </div>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={onSubmit}
            disabled={selectedAccountIds.size === 0}
            className="bg-blue-600 hover:bg-blue-700"
          >
            Update {selectedAccountIds.size} Account(s)
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
