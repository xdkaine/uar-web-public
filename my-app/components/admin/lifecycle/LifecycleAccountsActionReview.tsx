"use client";

import { Loader2, ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { LifecycleAccountsWorkspaceController } from "./LifecycleAccountsWorkspaceController";
import { LifecycleAccountsDeletionReview } from "./LifecycleAccountsDeletionReview";

export function LifecycleAccountsActionReview({ controller }: { controller: LifecycleAccountsWorkspaceController }) {
  const { reason, setReason, notes, setNotes, reference, setReference, dispatchActionDraft, exceptionEvidence, overrideAcknowledgement, running, canOverride, selectedAccounts, selectedAction, selectedIsDeletion, selectedNeedsOverride, overrideAccount, planReady, setConfirmationOpen } = controller;
  return (
    <>
{selectedAction && (
            <Card className="shadow-none">
              <CardHeader className="border-b pb-4">
                <CardTitle className="text-base">Review details</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedNeedsOverride
                    ? "An unowned directory change requires explicit evidence and confirmation."
                    : selectedIsDeletion
                      ? "Permanent deletion requires a reference and exact account confirmation."
                      : "Record why this access change is needed before review."}
                </p>
              </CardHeader>
              <CardContent className="grid gap-4 pt-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="lifecycle-reason">Reason</Label>
                  <Textarea
                    id="lifecycle-reason"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Required: why should access change?"
                  />
                </div>
                <div className="space-y-3">
                  <div className="space-y-2">
                    <Label htmlFor="lifecycle-reference">
                      Ticket or reference{" "}
                      {selectedNeedsOverride || selectedIsDeletion
                        ? "(required)"
                        : "(optional)"}
                    </Label>
                    <Input
                      id="lifecycle-reference"
                      value={reference}
                      onChange={(event) => setReference(event.target.value)}
                      placeholder="Incident, ticket, or change reference"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lifecycle-notes">
                      Internal notes (optional)
                    </Label>
                    <Input
                      id="lifecycle-notes"
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                    />
                  </div>
                </div>
                {selectedNeedsOverride && (
                  <Alert className="border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-100 lg:col-span-2">
                    <ShieldAlert />
                    <AlertTitle>Unowned directory action</AlertTitle>
                    <AlertDescription>
                      <p>
                        This changes one live AD account with no recorded portal
                        owner. It does not create or edit an access request, and
                        it cannot bypass conflicting ownership evidence.
                        Permanent deletion is a separate action and remains
                        unavailable until AD is disabled and the deletion
                        conditions are confirmed.
                      </p>
                      {!canOverride && (
                        <p className="mt-2 font-medium">
                          Your role does not have lifecycle.override.
                        </p>
                      )}
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <div>
                          <Label htmlFor="exception-evidence">
                            Observed directory state and evidence
                          </Label>
                          <Textarea
                            id="exception-evidence"
                            value={exceptionEvidence}
                            onChange={(event) =>
                              dispatchActionDraft({ type: "exceptionEvidence", value: event.target.value })
                            }
                            placeholder="At least 20 characters: observed state, expected state, and evidence"
                          />
                        </div>
                        <div>
                          <Label htmlFor="override-ack">
                            Type{" "}
                            {overrideAccount?.directory?.username ||
                              "the AD username"}{" "}
                            to confirm
                          </Label>
                          <Input
                            id="override-ack"
                            value={overrideAcknowledgement}
                            onChange={(event) =>
                              dispatchActionDraft({ type: "overrideAcknowledgement", value: event.target.value })
                            }
                          />
                        </div>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}
                <LifecycleAccountsDeletionReview controller={controller} />
                <div className="flex flex-col gap-3 border-t pt-4 lg:col-span-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <p className="font-medium">{selectedAction.label}</p>
                    <p className="text-muted-foreground">
                      {selectedAccounts.length} independently tracked change
                      {selectedAccounts.length === 1 ? "" : "s"}.
                    </p>
                  </div>
                  <Button
                    size="lg"
                    disabled={!planReady || running}
                    onClick={() => setConfirmationOpen(true)}
                  >
                    {running ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Running…
                      </>
                    ) : (
                      `Review ${selectedAccounts.length} change${selectedAccounts.length === 1 ? "" : "s"}`
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
    </>
  );
}
