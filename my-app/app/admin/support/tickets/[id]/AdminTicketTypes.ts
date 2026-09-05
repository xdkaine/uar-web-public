export interface TicketResponse {
  id: string;
  message: string;
  author: string;
  authorDisplayName?: string;
  isStaff: boolean;
  createdAt: string;
}

export interface TicketStatusLog {
  id: string;
  createdAt: string;
  oldStatus: string | null;
  newStatus: string;
  changedBy: string;
  changedByDisplayName?: string;
  isStaff: boolean;
}

export interface Ticket {
  id: string;
  subject: string;
  category: string | null;
  severity: string | null;
  body: string;
  status: string;
  username: string;
  displayName?: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedBy: string | null;
  responses: TicketResponse[];
  statusLogs: TicketStatusLog[];
  assignees?: string[];
  requestedForGroupDn?: string | null;
}
