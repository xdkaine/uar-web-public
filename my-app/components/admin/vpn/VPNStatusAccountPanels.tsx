"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Check } from "lucide-react";
import { ClientLocalDate } from "@/components/admin/ClientLocalDate";
import type { VPNAccount } from "./vpnManagementTypes";

interface InformationProps {
  selectedAccount: VPNAccount;
  statusBadge: ReactNode;
  portalBadge: ReactNode;
}

export function VPNStatusAccountInformation({
  selectedAccount,
  statusBadge,
  portalBadge,
}: InformationProps) {
  return (
    <>
      <div>
        <h4 className="text-lg font-semibold text-foreground mb-3">
          Account Information
        </h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-muted-foreground">Username</Label>
            <p className="text-foreground font-medium font-mono">
              {selectedAccount.username}
            </p>
          </div>
          <div>
            <Label className="text-muted-foreground">Name</Label>
            <p className="text-foreground">{selectedAccount.name}</p>
          </div>
          {selectedAccount.adUsername && (
            <div className="col-span-2">
              <Label className="text-muted-foreground">Linked AD Account</Label>
              <p className="text-foreground font-medium font-mono">
                {selectedAccount.adUsername}
              </p>
            </div>
          )}
          <div className="col-span-2">
            <Label className="text-muted-foreground">Email</Label>
            <p className="text-foreground">{selectedAccount.email}</p>
          </div>
          <div>
            <Label className="text-muted-foreground">Portal Type</Label>
            <div className="mt-1">{portalBadge}</div>
          </div>
          <div>
            <Label className="text-muted-foreground">Current Status</Label>
            <div className="mt-1">{statusBadge}</div>
          </div>
        </div>
      </div>

      <div>
        <h4 className="text-lg font-semibold text-foreground mb-3">
          Account Details
        </h4>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Label className="text-muted-foreground">Created</Label>
            <p className="text-foreground">
              <ClientLocalDate value={selectedAccount.createdAt} format="date" />
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              by {selectedAccount.createdBy}
            </p>
          </div>
          {selectedAccount.expiresAt && (
            <div>
              <Label className="text-muted-foreground">Expires</Label>
              <p className="text-foreground">
                <ClientLocalDate value={selectedAccount.expiresAt} format="date" />
              </p>
            </div>
          )}
          <div>
            <Label className="text-muted-foreground">Faculty Approval</Label>
            <div className="mt-1">
              {selectedAccount.createdByFaculty ? (
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-green-700 dark:text-green-200">
                  <Check className="w-4 h-4" />
                  Approved
                </span>
              ) : (
                <span className="text-sm font-semibold text-yellow-700 dark:text-yellow-200">
                  Pending
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {selectedAccount.notes && (
        <div>
          <h4 className="text-lg font-semibold text-foreground mb-3">Notes</h4>
          <div className="bg-muted/50 p-4 rounded-lg text-sm">
            <p className="text-foreground">{selectedAccount.notes}</p>
          </div>
        </div>
      )}
    </>
  );
}

export function VPNStatusAccountHistory({
  selectedAccount,
}: {
  selectedAccount: VPNAccount;
}) {
  return (
    <>
      {selectedAccount.disabledAt && (
        <div>
          <h4 className="text-lg font-semibold text-foreground mb-3">
            Disabled Information
          </h4>
          <div className="bg-red-50 dark:bg-red-950/40 p-4 rounded-lg border border-red-200 dark:border-red-900 text-sm">
            <div className="text-foreground space-y-2">
              <div>
                <span className="font-medium">Disabled on:</span>{" "}
                <ClientLocalDate value={selectedAccount.disabledAt} />
              </div>
              {selectedAccount.disabledBy && (
                <div>
                  <span className="font-medium">Disabled by:</span>{" "}
                  {selectedAccount.disabledBy}
                </div>
              )}
              {selectedAccount.disabledReason && (
                <div className="pt-2 border-t border-red-200 dark:border-red-900">
                  <span className="font-medium">Reason:</span>{" "}
                  {selectedAccount.disabledReason}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {selectedAccount.revokedAt && (
        <div>
          <h4 className="text-lg font-semibold text-foreground mb-3">
            Revoked Information
          </h4>
          <div className="bg-purple-50 dark:bg-purple-950/40 p-4 rounded-lg border border-purple-200 dark:border-purple-900 text-sm">
            <div className="text-foreground space-y-2">
              <div>
                <span className="font-medium">Revoked on:</span>{" "}
                <ClientLocalDate value={selectedAccount.revokedAt} />
              </div>
              {selectedAccount.revokedBy && (
                <div>
                  <span className="font-medium">Revoked by:</span>{" "}
                  {selectedAccount.revokedBy}
                </div>
              )}
              {selectedAccount.revokedReason && (
                <div className="pt-2 border-t border-purple-200 dark:border-purple-900">
                  <span className="font-medium">Reason:</span>{" "}
                  {selectedAccount.revokedReason}
                </div>
              )}
              {selectedAccount.restoredAt && (
                <>
                  <div className="pt-2 border-t border-purple-200 dark:border-purple-900">
                    <span className="font-medium">Previously Restored on:</span>{" "}
                    <ClientLocalDate value={selectedAccount.restoredAt} />
                  </div>
                  {selectedAccount.restoredBy && (
                    <div>
                      <span className="font-medium">Restored by:</span>{" "}
                      {selectedAccount.restoredBy}
                    </div>
                  )}
                </>
              )}
              {selectedAccount.canRestore === false && (
                <div className="pt-2 border-t border-purple-200 dark:border-purple-900">
                  <Badge variant="destructive">Cannot be restored</Badge>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
