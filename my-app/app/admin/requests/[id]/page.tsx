"use client";

import {
  use,
  useCallback,
  useEffect,
  useReducer,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import Toast from "@/components/Toast";
import { useToast } from "@/hooks/useToast";
import { useAdminPageTracking } from "@/hooks/useAdminPageTracking";
import RequestAccountSetupPanel from "./RequestAccountSetupPanel";
import RequestConfirmationDialogs from "./RequestConfirmationDialogs";
import RequestCommentsPanel from "./RequestCommentsPanel";
import RequestDecisionDialogs from "./RequestDecisionDialogs";
import RequestDetailHeader from "./RequestDetailHeader";
import RequestDetailWorkspace from "./RequestDetailWorkspace";
import RequestFacultyHandoffPanel from "./RequestFacultyHandoffPanel";
import RequestFinalApprovalPanel from "./RequestFinalApprovalPanel";
import RequestGrandfatheredNotice from "./RequestGrandfatheredNotice";
import RequestManualAssignmentPanel from "./RequestManualAssignmentPanel";
import RequestOperationRecoveryPanel from "./RequestOperationRecoveryPanel";
import RequestPreVerificationActions from "./RequestPreVerificationActions";
import RequestWorkflowRecoveryPanel from "./RequestWorkflowRecoveryPanel";
import { createAccountSetupActions } from "./accountSetupActions";
import { createManualAssignmentActions } from "./manualAssignmentActions";
import { createRequestReviewActions } from "./requestReviewActions";
import {
  initialRequestSnapshot,
  requestSnapshotReducer,
} from "./requestSnapshotState";
import { useFacultyHandoffController } from "./useFacultyHandoffController";
import { useManualAssignmentController } from "./useManualAssignmentController";
import { useRequestAccountDraft } from "./useRequestAccountDraft";
import { useRequestActionCoordinator } from "./useRequestActionCoordinator";
import { useRequestCommentsController } from "./useRequestCommentsController";
import { useRequestRecoveryActions } from "./useRequestRecoveryActions";

let expirationDateSnapshot: Date | undefined;
const subscribeToExpirationDate = () => () => {};
const getExpirationDateSnapshot = () => (expirationDateSnapshot ??= new Date());
const getServerExpirationDateSnapshot = () => undefined;

export default function RequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  useAdminPageTracking(
    `Access Request Detail - ${resolvedParams.id}`,
    "access_request",
  );
  const [snapshot, dispatchSnapshot] = useReducer(
    requestSnapshotReducer,
    initialRequestSnapshot,
  );
  const {
    request,
    actorDisplayNames,
    facultyHandoffTemplate,
    vpnModuleEnabled,
    capabilities,
    review,
    workflowRecoveryOptions,
    recoveryWorkflowId,
  } = snapshot;
  const [isLoading, setIsLoading] = useState(true);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showApproveModal, setShowApproveModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState("");
  const [approvalMessage, setApprovalMessage] = useState("");
  const { toast, showToast, hideToast } = useToast();
  const router = useRouter();
  const coordinator = useRequestActionCoordinator();
  const { onActionError } = coordinator;
  const minExpirationDate = useSyncExternalStore(
    subscribeToExpirationDate,
    getExpirationDateSnapshot,
    getServerExpirationDateSnapshot,
  );
  const manualAssignment = useManualAssignmentController({
    requestId: resolvedParams.id,
  });
  const { prefillGrandfatheredAccount } = manualAssignment;
  const { commentsPanelProps, refreshComments } = useRequestCommentsController({
    requestId: resolvedParams.id,
    showToast,
  });
  const accountDraft = useRequestAccountDraft({
    requestId: resolvedParams.id,
    showToast,
  });
  const { hydrateFromRequest } = accountDraft;

  const fetchRequest = useCallback(async () => {
    try {
      const response = await fetch(`/api/admin/requests/${resolvedParams.id}`);
      if (response.status === 401 || response.status === 403) {
        router.push(
          `/login?redirect=${encodeURIComponent(`/admin/requests/${resolvedParams.id}`)}`,
        );
        return;
      }
      if (!response.ok) throw new Error("Failed to fetch request");
      const data = await response.json();
      dispatchSnapshot({ type: "loaded", payload: data });
      prefillGrandfatheredAccount(data.request);
      hydrateFromRequest(data.request);
      if (data.capabilities?.canRespond) refreshComments();
    } catch (error) {
      onActionError(
        error instanceof Error ? error.message : "An error occurred",
      );
    } finally {
      setIsLoading(false);
    }
  }, [
    hydrateFromRequest,
    onActionError,
    prefillGrandfatheredAccount,
    refreshComments,
    resolvedParams.id,
    router,
  ]);

  const recoveryActions = useRequestRecoveryActions({
    requestId: resolvedParams.id,
    request,
    recoveryWorkflowId,
    onRecoveryStart: coordinator.onRecoveryStart,
    onActionComplete: coordinator.onActionComplete,
    showToast,
    refreshRequest: fetchRequest,
  });
  const facultyHandoff = useFacultyHandoffController({
    requestId: resolvedParams.id,
    request,
    facultyHandoffTemplate,
    showToast,
    onActionStart: coordinator.onActionStart,
    onActionComplete: coordinator.onActionComplete,
    onActionError: coordinator.onActionError,
    refreshRequest: fetchRequest,
    openConfirmation: coordinator.openConfirmation,
    closeConfirmation: coordinator.closeConfirmation,
  });
  const accountActions = createAccountSetupActions({
    requestId: resolvedParams.id,
    request,
    vpnModuleEnabled,
    ldapUsername: accountDraft.ldapUsername,
    vpnUsername: accountDraft.vpnUsername,
    password: accountDraft.password,
    usernameCheckMessage: accountDraft.usernameCheckMessage,
    expirationDateTime: accountDraft.expirationDateTime,
    showToast,
    openConfirmation: coordinator.openConfirmation,
    closeConfirmation: coordinator.closeConfirmation,
    onActionStart: coordinator.onActionStart,
    onActionComplete: coordinator.onActionComplete,
    onActionError: coordinator.onActionError,
    refreshRequest: fetchRequest,
    redirectToAdmin: () => router.push("/admin"),
  });
  const reviewActions = createRequestReviewActions({
    requestId: resolvedParams.id,
    approvalMessage,
    rejectionReason,
    showToast,
    setShowApproveModal,
    setShowRejectModal,
    setApprovalMessage,
    setRejectionReason,
    openConfirmation: coordinator.openConfirmation,
    closeConfirmation: coordinator.closeConfirmation,
    onActionStart: coordinator.onActionStart,
    onActionComplete: coordinator.onActionComplete,
    onActionError: coordinator.onActionError,
    refreshRequest: fetchRequest,
    redirectToAdmin: () => router.push("/admin"),
  });
  const { submitManualAssignment } = createManualAssignmentActions({
    requestId: resolvedParams.id,
    actionLoading: coordinator.actionLoading,
    isInternal: Boolean(request?.isInternal),
    linkedAdUsername: manualAssignment.linkedAdUsername,
    linkedVpnUsername: manualAssignment.linkedVpnUsername,
    manualAssignmentNotes: manualAssignment.manualAssignmentNotes,
    adUsernameCheckMessage: manualAssignment.adUsernameCheckMessage,
    vpnUsernameCheckMessage: manualAssignment.vpnUsernameCheckMessage,
    showToast,
    hideManualAssignment: manualAssignment.hideManualAssignment,
    resetManualAssignmentDraft: manualAssignment.resetManualAssignmentDraft,
    openConfirmation: coordinator.openConfirmation,
    closeConfirmation: coordinator.clearConfirmation,
    onActionStart: coordinator.onActionStart,
    onActionComplete: coordinator.onActionComplete,
    onActionError: coordinator.onActionError,
    redirectToAdmin: () => router.push("/admin"),
  });

  useEffect(() => {
    document.title = "Request Details | User Access Request (UAR) Portal";
  }, []);
  useEffect(() => {
    fetchRequest();
  }, [fetchRequest]);

  if (isLoading) return <RequestState message="Loading..." />;
  if (!request) return <RequestState message="Request not found" />;

  return (
    <RequestDetailView
      {...{
        request,
        actorDisplayNames,
        capabilities,
        review,
        workflowRecoveryOptions,
        recoveryWorkflowId,
        coordinator,
        recoveryActions,
        commentsPanelProps,
        accountDraft,
        accountActions,
        manualAssignment,
        facultyHandoff,
        reviewActions,
        vpnModuleEnabled,
        minExpirationDate,
        showRejectModal,
        rejectionReason,
        showApproveModal,
        approvalMessage,
        setRejectionReason,
        setApprovalMessage,
        submitManualAssignment,
        onWorkflowChange: (id) =>
          dispatchSnapshot({ type: "recoveryWorkflowSelected", id }),
        onBack: () => router.push("/admin"),
        toast,
        hideToast,
      }}
    />
  );
}

type RequestDetailViewProps = {
  request: NonNullable<typeof initialRequestSnapshot.request>;
  actorDisplayNames: Record<string, string>;
  capabilities: typeof initialRequestSnapshot.capabilities;
  review: typeof initialRequestSnapshot.review;
  workflowRecoveryOptions: typeof initialRequestSnapshot.workflowRecoveryOptions;
  recoveryWorkflowId: string;
  coordinator: ReturnType<typeof useRequestActionCoordinator>;
  recoveryActions: ReturnType<typeof useRequestRecoveryActions>;
  commentsPanelProps: ReturnType<
    typeof useRequestCommentsController
  >["commentsPanelProps"];
  accountDraft: ReturnType<typeof useRequestAccountDraft>;
  accountActions: ReturnType<typeof createAccountSetupActions>;
  manualAssignment: ReturnType<typeof useManualAssignmentController>;
  facultyHandoff: ReturnType<typeof useFacultyHandoffController>;
  reviewActions: ReturnType<typeof createRequestReviewActions>;
  vpnModuleEnabled: boolean;
  minExpirationDate: Date | undefined;
  showRejectModal: boolean;
  rejectionReason: string;
  showApproveModal: boolean;
  approvalMessage: string;
  setRejectionReason: (value: string) => void;
  setApprovalMessage: (value: string) => void;
  submitManualAssignment: () => Promise<void>;
  onWorkflowChange: (id: string) => void;
  onBack: () => void;
  toast: ReturnType<typeof useToast>["toast"];
  hideToast: ReturnType<typeof useToast>["hideToast"];
};

function RequestDetailView({
  request,
  actorDisplayNames,
  capabilities,
  review,
  workflowRecoveryOptions,
  recoveryWorkflowId,
  coordinator,
  recoveryActions,
  commentsPanelProps,
  accountDraft,
  accountActions,
  manualAssignment,
  facultyHandoff,
  reviewActions,
  vpnModuleEnabled,
  minExpirationDate,
  showRejectModal,
  rejectionReason,
  showApproveModal,
  approvalMessage,
  setRejectionReason,
  setApprovalMessage,
  submitManualAssignment,
  onWorkflowChange,
  onBack,
  toast,
  hideToast,
}: RequestDetailViewProps) {
  const operationRecoveryPanel = buildOperationRecoveryPanel(
    request,
    capabilities,
    review,
    coordinator.actionLoading,
    recoveryActions.reconcileOperation,
  );
  return (
    <div className="min-h-screen bg-linear-to-b from-white to-gray-100 dark:from-background dark:to-muted text-foreground">
      <div className="mx-auto w-full max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8 sm:py-8">
        <RequestDetailHeader
          request={request}
          review={review}
          onBack={onBack}
        />
        <div className="bg-card rounded-lg shadow-xl p-4 sm:p-6 md:p-8 border-2 border-border">
          {coordinator.error && (
            <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-red-700 dark:text-red-200 rounded-lg text-sm sm:text-base">
              {coordinator.error}
            </div>
          )}
          <RequestWorkflowRecoveryPanel
            warning={review?.workflow.warning ?? null}
            canConfigureGovernance={capabilities.canConfigureGovernance}
            options={workflowRecoveryOptions}
            selectedWorkflowId={recoveryWorkflowId}
            reason={recoveryActions.workflowRecoveryReason}
            actionLoading={coordinator.actionLoading}
            onWorkflowChange={onWorkflowChange}
            onReasonChange={(event) =>
              recoveryActions.setWorkflowRecoveryReason(event.target.value)
            }
            onReconcile={recoveryActions.reconcileRequestWorkflow}
          />
          <RequestGrandfatheredNotice request={request} />
          <RequestDetailWorkspace
            request={request}
            actorDisplayNames={actorDisplayNames}
            capabilities={capabilities}
            review={review}
            operationRecoveryPanel={operationRecoveryPanel}
            commentsPanel={<RequestCommentsPanel {...commentsPanelProps} />}
            preVerificationActions={
              <RequestPreVerificationActions
                status={request.status}
                canReject={capabilities.canRejectPreVerification}
                actionLoading={coordinator.actionLoading}
                onReject={reviewActions.handleReject}
              />
            }
            accountSetupPanel={
              <RequestAccountSetupPanel
                request={request}
                stageLabel={review?.currentStage?.label}
                actionLoading={coordinator.actionLoading}
                ldapUsername={accountDraft.ldapUsername}
                vpnUsername={accountDraft.vpnUsername}
                password={accountDraft.password}
                showPassword={accountDraft.showPassword}
                expirationDateTime={accountDraft.expirationDateTime}
                minExpirationDate={minExpirationDate}
                usernameCheckMessage={accountDraft.usernameCheckMessage}
                vpnModuleEnabled={vpnModuleEnabled}
                onLdapUsernameChange={accountDraft.onLdapUsernameChange}
                onVpnUsernameChange={accountDraft.onVpnUsernameChange}
                onPasswordChange={accountDraft.onPasswordChange}
                onTogglePassword={accountDraft.onTogglePassword}
                onCheckUsernameAvailability={
                  accountDraft.checkUsernameAvailability
                }
                onGeneratePassword={accountDraft.generatePassword}
                onExpirationDateTimeChange={
                  accountDraft.onExpirationDateTimeChange
                }
                onCreateAccount={accountActions.handleCreateAccount}
                onManualAssign={manualAssignment.openManualAssignment}
                onUpdateAccount={accountActions.handleUpdateAccount}
                onReturnToFaculty={
                  reviewActions.openReturnToFacultyConfirmation
                }
                onReject={reviewActions.handleReject}
                supportsFacultyHandoff={Boolean(
                  review?.actions.supportsFacultyHandoff,
                )}
              />
            }
            facultyHandoffPanel={
              <RequestFacultyHandoffPanel
                request={request}
                stageLabel={review?.currentStage?.label}
                actionLoading={coordinator.actionLoading}
                canRevealPassword={Boolean(
                  !request.isInternal &&
                  request.hasPassword &&
                  capabilities.canProvision,
                )}
                {...facultyHandoff}
                onApprove={reviewActions.handleApprove}
                onReject={reviewActions.handleReject}
                onMoveBack={reviewActions.openMoveBackConfirmation}
              />
            }
            finalApprovalPanel={
              <RequestFinalApprovalPanel
                stageLabel={review?.currentStage?.label}
                workflowVersion={review?.workflow.version ?? 0}
                actionLoading={coordinator.actionLoading}
                onApprove={reviewActions.handleApprove}
                onReject={reviewActions.handleReject}
              />
            }
          />
        </div>
      </div>
      <RequestDecisionDialogs
        showRejectModal={showRejectModal}
        rejectionReason={rejectionReason}
        showApproveModal={showApproveModal}
        approvalMessage={approvalMessage}
        onRejectOpenChange={reviewActions.onRejectOpenChange}
        onRejectionReasonChange={(event) =>
          setRejectionReason(event.target.value)
        }
        onCancelReject={reviewActions.closeRejectModal}
        onSubmitRejection={reviewActions.submitRejection}
        onApproveOpenChange={reviewActions.onApproveOpenChange}
        onApprovalMessageChange={(event) =>
          setApprovalMessage(event.target.value)
        }
        onCancelApprove={reviewActions.closeApproveModal}
        onSubmitApproval={reviewActions.submitApproval}
      />
      <RequestConfirmationDialogs
        showConfirmModal={coordinator.showConfirmModal}
        confirmModalConfig={coordinator.confirmModalConfig}
        onStandardOpenChange={(open) =>
          !open && coordinator.closeConfirmation()
        }
        onCancelStandard={coordinator.closeConfirmation}
        onConfirmStandard={() => coordinator.confirmModalConfig?.onConfirm()}
        onUsernameMismatchOpenChange={(open) => {
          if (!open) {
            coordinator.clearConfirmation();
            manualAssignment.reopenManualAssignment();
          }
        }}
        onCancelUsernameMismatch={() => {
          coordinator.clearConfirmation();
          manualAssignment.reopenManualAssignment();
        }}
        onConfirmUsernameMismatch={() =>
          coordinator.confirmModalConfig?.onConfirm()
        }
      />
      {capabilities.canProvision && (
        <RequestManualAssignmentPanel
          request={request}
          open={manualAssignment.showManualAssignModal}
          linkedAdUsername={manualAssignment.linkedAdUsername}
          linkedVpnUsername={manualAssignment.linkedVpnUsername}
          manualAssignmentNotes={manualAssignment.manualAssignmentNotes}
          adUsernameCheckMessage={manualAssignment.adUsernameCheckMessage}
          vpnUsernameCheckMessage={manualAssignment.vpnUsernameCheckMessage}
          onClose={manualAssignment.closeManualAssignment}
          onLinkedAdUsernameChange={manualAssignment.onLinkedAdUsernameChange}
          onLinkedVpnUsernameChange={manualAssignment.onLinkedVpnUsernameChange}
          onManualAssignmentNotesChange={
            manualAssignment.onManualAssignmentNotesChange
          }
          onCheckAdUsernameExists={manualAssignment.checkAdUsernameExists}
          onCheckVpnUsernameExists={manualAssignment.checkVpnUsernameExists}
          onSubmit={submitManualAssignment}
        />
      )}
      <Toast
        message={toast.message}
        type={toast.type}
        isVisible={toast.isVisible}
        onClose={hideToast}
      />
    </div>
  );
}

function RequestState({ message }: { message: string }) {
  return (
    <div className="min-h-screen bg-linear-to-b from-white to-gray-100 dark:from-background dark:to-muted flex items-center justify-center">
      <div className="text-foreground text-xl font-semibold">{message}</div>
    </div>
  );
}

function buildOperationRecoveryPanel(
  request: NonNullable<typeof initialRequestSnapshot.request>,
  capabilities: typeof initialRequestSnapshot.capabilities,
  review: typeof initialRequestSnapshot.review,
  actionLoading: boolean,
  reconcileOperation: (
    path:
      | "reconcile-account-update"
      | "reconcile-faculty-notification"
      | "reconcile-stage-notification",
    resolution: "not_applied" | "delivered" | "not_delivered",
  ) => Promise<void>,
) {
  const accountUpdate =
    request.accountUpdateState === "reconciliation_required" &&
    capabilities.canProvision
      ? {
          message: request.accountUpdateError || "outcome unknown",
          onNotApplied: () =>
            reconcileOperation("reconcile-account-update", "not_applied"),
        }
      : null;
  const facultyNotification =
    request.facultyNotificationState === "delivery_unknown" &&
    capabilities.canReviewFaculty
      ? {
          message:
            request.facultyNotificationError || "delivery outcome unknown",
          onDelivered: () =>
            reconcileOperation("reconcile-faculty-notification", "delivered"),
          onNotDelivered: () =>
            reconcileOperation(
              "reconcile-faculty-notification",
              "not_delivered",
            ),
        }
      : null;
  const stageNotification =
    request.stageNotificationState === "delivery_unknown" &&
    review?.currentStage &&
    (review.actions.canAcknowledge || review.actions.canApprove)
      ? {
          label: review.currentStage.label,
          message: request.stageNotificationError || "delivery outcome unknown",
          onDelivered: () =>
            reconcileOperation("reconcile-stage-notification", "delivered"),
          onNotDelivered: () =>
            reconcileOperation("reconcile-stage-notification", "not_delivered"),
        }
      : null;
  return (
    (accountUpdate || facultyNotification || stageNotification) && (
      <RequestOperationRecoveryPanel
        actionLoading={actionLoading}
        accountUpdate={accountUpdate}
        facultyNotification={facultyNotification}
        stageNotification={stageNotification}
      />
    )
  );
}
