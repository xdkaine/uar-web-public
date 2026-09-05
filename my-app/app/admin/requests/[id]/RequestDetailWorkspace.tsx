import type { ReactNode } from "react";
import RequestDetailMetadata from "./RequestDetailMetadata";
import RequestApprovedDetails from "./RequestApprovedDetails";
import RequestRejectedDetails from "./RequestRejectedDetails";
import type {
  AccessRequest,
  RequestCapabilities,
  RequestReview,
} from "./RequestDetailTypes";

interface RequestDetailWorkspaceProps {
  request: AccessRequest;
  actorDisplayNames: Record<string, string>;
  capabilities: RequestCapabilities;
  review: RequestReview | null;
  operationRecoveryPanel: ReactNode;
  commentsPanel: ReactNode;
  preVerificationActions: ReactNode;
  accountSetupPanel: ReactNode;
  facultyHandoffPanel: ReactNode;
  finalApprovalPanel: ReactNode;
}

export default function RequestDetailWorkspace({
  request,
  actorDisplayNames,
  capabilities,
  review,
  operationRecoveryPanel,
  commentsPanel,
  preVerificationActions,
  accountSetupPanel,
  facultyHandoffPanel,
  finalApprovalPanel,
}: RequestDetailWorkspaceProps) {
  return (
    <div className="space-y-4 sm:space-y-6">
      <RequestDetailMetadata
        request={request}
        actorDisplayNames={actorDisplayNames}
        includeDetails={false}
      />
      <RequestRejectedDetails request={request} />
      {operationRecoveryPanel}
      <RequestApprovedDetails
        request={request}
        actorDisplayNames={actorDisplayNames}
      />
      {capabilities.canRespond && commentsPanel}
      <RequestReviewPanels
        request={request}
        review={review}
        capabilities={capabilities}
        accountSetupPanel={accountSetupPanel}
        facultyHandoffPanel={facultyHandoffPanel}
        finalApprovalPanel={finalApprovalPanel}
      />
      {preVerificationActions}
      <RequestVerificationNotice status={request.status} />
    </div>
  );
}

function RequestReviewPanels({
  request,
  review,
  capabilities,
  accountSetupPanel,
  facultyHandoffPanel,
  finalApprovalPanel,
}: Pick<
  RequestDetailWorkspaceProps,
  | "request"
  | "review"
  | "capabilities"
  | "accountSetupPanel"
  | "facultyHandoffPanel"
  | "finalApprovalPanel"
>) {
  const actions = review?.actions;
  const canProcessVerifiedRequest =
    request.isVerified &&
    Boolean(actions?.canApprove || actions?.canAcknowledge);

  return (
    <>
      {canProcessVerifiedRequest &&
        capabilities.canProvision &&
        accountSetupPanel}
      {canProcessVerifiedRequest &&
        actions?.canApprove &&
        actions.supportsFacultyHandoff &&
        facultyHandoffPanel}
      {canProcessVerifiedRequest &&
        actions?.canApprove &&
        !actions.supportsFacultyHandoff &&
        finalApprovalPanel}
    </>
  );
}

function RequestVerificationNotice({ status }: { status: string }) {
  if (status !== "pending_verification") return null;

  return (
    <div className="border-t border-border pt-4 sm:pt-6">
      <div className="bg-yellow-50 dark:bg-yellow-950/40 border border-yellow-200 dark:border-yellow-900 text-yellow-800 p-3 sm:p-4 rounded-lg flex items-start gap-2 sm:gap-3">
        <svg
          className="w-5 h-5 shrink-0 mt-0.5"
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path
            fillRule="evenodd"
            d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0V6a1 1 0 002 0v3a1 1 0 00-1-1z"
            clipRule="evenodd"
          />
        </svg>
        <p className="text-xs sm:text-sm">
          This request cannot be processed until the user verifies their email
          address.
        </p>
      </div>
    </div>
  );
}
