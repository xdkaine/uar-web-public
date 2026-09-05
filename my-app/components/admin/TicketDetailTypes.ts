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
  displayName?: string;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  closedBy: string | null;
  responses: TicketResponse[];
  statusLogs: TicketStatusLog[];
  requestedForGroupDn?: string | null;
}

export const formatTicketStatus = (status: string) => status.replace('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());

export const ticketSeverityClass = (severity: string | null) => ({ critical: 'bg-red-100 dark:bg-red-950/60 text-red-800 border-red-200 dark:border-red-900', high: 'bg-orange-100 dark:bg-orange-950/60 text-orange-800 border-orange-200 dark:border-orange-900', medium: 'bg-yellow-100 dark:bg-yellow-950/60 text-yellow-800 border-yellow-200 dark:border-yellow-900', low: 'bg-green-100 dark:bg-green-950/60 text-green-800 border-green-200 dark:border-green-900' }[severity ?? ''] ?? 'bg-muted text-foreground border-border');

export const ticketStatusClass = (status: string) => ({ open: 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 border-blue-200 dark:border-blue-900', in_progress: 'bg-purple-100 dark:bg-purple-950/60 text-purple-800 border-purple-200 dark:border-purple-900' }[status] ?? 'bg-muted text-foreground border-border');
