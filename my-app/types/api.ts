export interface ApiSuccessResponse<T = unknown> {
  success: true;
  data?: T;
  message?: string;
}

export interface ApiErrorResponse {
  success?: false;
  error: string;
  details?: string;
  code?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface RateLimitHeaders {
  'X-RateLimit-Limit': string;
  'X-RateLimit-Remaining': string;
  'X-RateLimit-Reset': string;
  'Retry-After'?: string;
}
export interface AccessRequestsResponse {
  requests: import('./admin').AccessRequest[];
  total?: number;
}

export interface VPNAccountsResponse {
  accounts: import('./admin').VPNAccount[];
  total?: number;
}

export interface SupportTicketsResponse {
  tickets: import('./admin').SupportTicket[];
  total?: number;
}

export interface EventsResponse {
  events: import('./admin').Event[];
  total?: number;
}

export interface BatchCreationsResponse {
  batches: import('./admin').BatchCreation[];
  total?: number;
}

export interface SyncStatusResponse {
  accounts: import('./admin').SyncStatusAccount[];
  latestSync?: {
    id: string;
    createdAt: string;
    status: string;
  };
}
export interface BulkActionResponse {
  success: boolean;
  updatedCount: number;
  skippedCount?: number;
  errors?: Array<{
    id: string;
    error: string;
  }>;
}

export interface StatusChangeResponse {
  success: boolean;
  previousStatus: string;
  newStatus: string;
  message?: string;
}
export interface AuditLogEntry {
  id: string;
  createdAt: string;
  action: string;
  category: string;
  username: string;
  actorType?: ActionHistoryActorType;
  targetId?: string;
  targetType?: string;
  subjectUsername?: string;
  subjectEmail?: string;
  relatedRequestId?: string;
  relatedVpnAccountId?: string;
  relatedLifecycleActionId?: string;
  eventKind?: ActionHistoryEventKind;
  outcome?: ActionHistoryOutcome;
  correlationId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
  success: boolean;
}

export interface AuditLogsResponse {
  logs: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
}

export type ActionHistoryActorType = 'admin' | 'user' | 'system' | 'anonymous';
export type ActionHistoryEventKind = 'read' | 'write' | 'notification' | 'security' | 'system' | 'lifecycle' | 'sync';
export type ActionHistoryOutcome = 'success' | 'failure' | 'denied' | 'pending' | 'rollback' | 'skipped';
export type ActionHistorySource =
  | 'audit_log'
  | 'request_comment'
  | 'request_state'
  | 'lifecycle_history'
  | 'ad_activity'
  | 'vpn_status'
  | 'vpn_activity'
  | 'ad_sync'
  | 'offboard_log'
  | 'token_summary';

export interface ActionHistoryItem {
  id: string;
  source: ActionHistorySource;
  sourceId?: string;
  createdAt: string;
  title: string;
  description?: string;
  action?: string;
  category?: string;
  actor: string;
  actorType: ActionHistoryActorType;
  eventKind: ActionHistoryEventKind;
  outcome: ActionHistoryOutcome;
  targetId?: string;
  targetType?: string;
  subjectName?: string;
  subjectUsername?: string;
  subjectEmail?: string;
  relatedRequestId?: string;
  relatedVpnAccountId?: string;
  relatedLifecycleActionId?: string;
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
  details?: Record<string, unknown>;
  isReadEvent?: boolean;
  isDerived?: boolean;
}

export interface ActionHistoryResponse {
  items: ActionHistoryItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  subjects: {
    requestIds: string[];
    usernames: string[];
    emails: string[];
    vpnAccountIds: string[];
  };
}
