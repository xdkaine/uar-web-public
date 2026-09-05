export interface BlockedEmail {
  id: string;
  createdAt: string;
  updatedAt: string;
  email: string;
  reason: string;
  notes: string | null;
  linkedTicketId: string | null;
  blockedBy: string;
  isActive: boolean;
  deactivatedAt: string | null;
  deactivatedBy: string | null;
  deactivationNotes: string | null;
}

export interface BlockedEmailFormData {
  email: string;
  reason: string;
  notes: string;
  linkedTicketId: string;
}

export type BlocklistFilterStatus = "all" | "active" | "inactive";
