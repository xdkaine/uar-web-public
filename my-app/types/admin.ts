export type AccessRequestStatus = 
  | 'pending_verification' 
  | 'pending_student_directors' 
  | 'pending_faculty' 
  | 'approved' 
  | 'rejected';

export interface AccessRequestEvent {
  id: string;
  name: string;
}

export interface AccessRequest {
  id: string;
  createdAt: string;
  name: string;
  email: string;
  isInternal: boolean;
  needsDomainAccount: boolean;
  institution?: string;
  eventReason?: string;
  eventId?: string;
  event?: AccessRequestEvent;
  accountExpiresAt?: string;
  isVerified: boolean;
  status: AccessRequestStatus;
  verifiedAt?: string;
  ldapUsername?: string;
  vpnUsername?: string;
}
export interface Event {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  endDate?: string;
  _count?: { 
    accessRequests: number; 
  };
}
export type VPNAccountStatus = 'active' | 'pending_faculty' | 'disabled' | 'revoked';

export type VPNPortalType = 'Management' | 'Limited' | 'External';

export interface VPNAccount {
  id: string;
  username: string;
  name: string;
  email: string;
  portalType: VPNPortalType | string;
  isInternal: boolean;
  status: VPNAccountStatus | string;
  expiresAt?: string;
  createdAt: string;
  createdBy: string;
  createdByFaculty: boolean;
  facultyCreatedAt?: string;
  disabledAt?: string;
  disabledBy?: string;
  disabledReason?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
  restoredAt?: string;
  restoredBy?: string;
  canRestore?: boolean;
  notes?: string;
  adUsername?: string;
}

export type VPNStatusFilter = 'all' | 'active' | 'pending_faculty' | 'disabled' | 'revoked';
export type VPNPortalFilter = 'all' | 'Management' | 'Limited' | 'External';
export type VPNFacultyFilter = 'all' | 'approved' | 'pending';
export interface TicketResponse {
  id: string;
  message: string;
  author: string;
  isStaff: boolean;
  createdAt: string;
}

export interface TicketStatusLog {
  id: string;
  createdAt: string;
  oldStatus: string | null;
  newStatus: string;
  changedBy: string;
  isStaff: boolean;
}

export interface SupportTicket {
  id: string;
  subject: string;
  category: string | null;
  severity: string | null;
  body: string;
  status: string;
  username: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedBy: string | null;
  responses: TicketResponse[];
  statusLogs: TicketStatusLog[];
}
export interface BatchAccountItem {
  id: string;
  accessRequestId?: string | null;
  name: string;
  ldapUsername: string;
  status: string;
  errorMessage?: string;
}

export interface BatchCreation {
  id: string;
  createdAt: string;
  createdBy: string;
  description: string;
  totalAccounts: number;
  successfulAccounts: number;
  failedAccounts: number;
  status: string;
  completedAt?: string;
  linkedTicket?: {
    id: string;
    subject: string;
    status: string;
  };
  accounts: BatchAccountItem[];
  _count: {
    accounts: number;
    auditLogs: number;
  };
}
export type SyncStatusType = 
  | 'fully_synced' 
  | 'partial_sync' 
  | 'ad_only' 
  | 'vpn_only' 
  | 'request_only' 
  | 'orphaned';

export interface SyncStatusAccount {
  identifier: string;
  name: string;
  email: string | null;
  hasAdAccount: boolean;
  adUsername: string | null;
  adDisplayName: string | null;
  adEmail: string | null;
  adSyncDate: string | null;
  hasVpnAccount: boolean;
  vpnUsername: string | null;
  vpnPortalType: string | null;
  vpnStatus: string | null;
  vpnCreatedAt: string | null;
  hasAccessRequest: boolean;
  requestId: string | null;
  requestStatus: string | null;
  requestCreatedAt: string | null;
  isManuallyAssigned: boolean;
  syncStatus: SyncStatusType;
  syncIssues: string[];
  lastSyncId: string | null;
  wasAutoAssigned: boolean;
}

export type StatusFilter = 'all' | AccessRequestStatus;
export type TypeFilter = 'all' | 'internal' | 'external';
export type VerificationFilter = 'all' | 'verified' | 'unverified';
