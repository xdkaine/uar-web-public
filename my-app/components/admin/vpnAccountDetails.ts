export interface VPNAccountDetail {
  id: string;
  username: string;
  name: string;
  email: string;
  portalType: string;
  isInternal: boolean;
  status: string;
  expiresAt?: string;
  password: string;
  createdAt: string;
  updatedAt: string;
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
  canRestore: boolean;
  notes?: string;
  batchId?: string;
  accessRequestId?: string;
  importId?: string;
  adUsername?: string;
  statusLogs?: Array<{
    id: string;
    createdAt: string;
    oldStatus?: string;
    newStatus: string;
    changedBy: string;
    reason?: string;
  }>;
}

export interface VPNAccountComment {
  id: string;
  createdAt: string;
  updatedAt: string;
  comment: string;
  author: string;
  type?: string;
}

export const formatDate = (date?: string) => {
  if (!date) return 'N/A';
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};
