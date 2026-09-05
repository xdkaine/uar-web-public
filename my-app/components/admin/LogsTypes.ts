export interface AuditLog {
  id: string;
  createdAt: string;
  action: string;
  category: string;
  username: string;
  actorDisplayName?: string | null;
  actorType?: string;
  targetId?: string;
  targetType?: string;
  subjectUsername?: string;
  subjectDisplayName?: string | null;
  subjectEmail?: string;
  relatedRequestId?: string;
  relatedVpnAccountId?: string;
  relatedLifecycleActionId?: string;
  eventKind?: string;
  outcome?: string;
  correlationId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
  errorMessage?: string;
}

export interface LogsResponse {
  logs: AuditLog[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

export interface LogFilters {
  action: string;
  category: string;
  username: string;
  targetType: string;
  eventKind: string;
  outcome: string;
  success: string;
  search: string;
  startDate: string;
  endDate: string;
}

export interface AuditStats {
  last24Hours: number;
  last7Days: number;
  last30Days: number;
}
