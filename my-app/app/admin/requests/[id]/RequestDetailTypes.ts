export interface AccessRequest {
  id: string;
  version: number;
  workflowVersionId?: string | null;
  createdAt: string;
  updatedAt: string;
  name: string;
  email: string;
  isInternal: boolean;
  needsDomainAccount: boolean;
  institution?: string;
  eventReason?: string;
  eventId?: string;
  event?: {
    id: string;
    name: string;
    description?: string;
    endDate?: string;
  };
  accessEndTime?: string;
  isVerified: boolean;
  verificationToken?: string;
  verifiedAt?: string;
  status: string;
  acknowledgedByDirector: boolean;
  acknowledgedAt?: string;
  acknowledgedBy?: string;
  approvedAt?: string;
  approvedBy?: string;
  approvalMessage?: string;
  ldapUsername?: string;
  vpnUsername?: string;
  hasPassword?: boolean;
  passwordStatus?: string | null;
  accountCreatedAt?: string;
  accountExpiresAt?: string;
  sentToFacultyAt?: string;
  sentToFacultyBy?: string;
  rejectionReason?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  isManuallyAssigned?: boolean;
  manuallyAssignedAt?: string;
  manuallyAssignedBy?: string;
  linkedAdUsername?: string;
  linkedVpnUsername?: string;
  manualAssignmentNotes?: string;
  isGrandfatheredAccount?: boolean;
  facultyNotificationState?: string | null;
  facultyNotificationError?: string | null;
  stageNotificationState?: string | null;
  stageNotificationStageKey?: string | null;
  stageNotificationError?: string | null;
  accountUpdateState?: string | null;
  accountUpdateError?: string | null;
}

export interface RequestComment {
  id: string;
  createdAt: string;
  updatedAt: string;
  comment: string;
  author: string;
  authorDisplayName?: string;
  type?: string;
  attachments?: Array<{
    id: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
  }>;
}

export interface RequestCapabilities {
  canRespond: boolean;
  canProvision: boolean;
  canReviewDirector: boolean;
  canReviewFaculty: boolean;
  canRejectPreVerification: boolean;
  canConfigureGovernance?: boolean;
}

export interface RequestReview {
  workflow: {
    id: string | null;
    version: number;
    source: 'pinned' | 'legacy_active' | 'builtin';
    integrity: string;
    warning: string | null;
  };
  currentStage: {
    key: string;
    label: string;
    order: number;
    total: number;
    isFinal: boolean;
  } | null;
  actions: {
    canAcknowledge: boolean;
    canApprove: boolean;
    canReject: boolean;
    supportsFacultyHandoff: boolean;
  };
}
