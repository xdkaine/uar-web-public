export interface VPNAccount {
  id: string;
  username: string;
  name: string;
  email: string | null;
  portalType: string;
  isInternal: boolean;
  status: string;
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
  notes?: string | null;
  adUsername?: string | null; // Linked AD account username
}
