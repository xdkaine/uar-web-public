import type {
  BatchAccountDetailIssue,
  BatchAccountLifecycleOwnerKind,
  BatchAccountSystem,
} from "@/lib/batch-account-detail";

export interface BatchAccount {
  id: string;
  createdAt: string;
  updatedAt: string;
  accountSystem: BatchAccountSystem;
  accountSystemLabel: string;
  username: string;
  name: string;
  email: string | null;
  batchId: string;
  accessRequestId: string | null;
  lifecycleOwnerKind: BatchAccountLifecycleOwnerKind;
  accountExpiresAt: string | null;
  isInternal: boolean;
  status: string;
  stageLabel: string;
  provisionedAt: string | null;
  errorMessage: string | null;
  completedAt: string | null;
  directoryDn: string | null;
  directoryObjectGuid: string | null;
  issues: BatchAccountDetailIssue[];
  needsAttention: boolean;
}

export interface AuditLog {
  id: string;
  createdAt: string;
  action: string;
  details: string;
  performedBy: string;
  accountName: string | null;
  success: boolean;
}

export interface BatchDetail {
  id: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  canExport: boolean;
  description: string;
  totalAccounts: number;
  successfulAccounts: number;
  failedAccounts: number;
  status: string;
  completedAt: string | null;
  linkedTicket: {
    id: string;
    subject: string;
    status: string;
    category: string | null;
    severity: string | null;
  } | null;
  accounts: BatchAccount[];
  auditLogs: AuditLog[];
  integrityIssues: BatchAccountDetailIssue[];
}

export type AccountFilter = "all" | "attention" | "ad" | "vpn";

export interface BatchAccountCounts {
  all: number;
  attention: number;
  ad: number;
  vpn: number;
  issues: number;
  linkedRequests: number;
  completed: number;
  failed: number;
  rolledBack: number;
  reconciliation: number;
  open: number;
  other: number;
}
