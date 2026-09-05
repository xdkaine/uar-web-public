import type { TicketFormValues } from '@/lib/support/ticket-form-schema';

export type AccountIntent = 'problem' | 'join_group';

export interface TicketDraft {
  subject: string;
  category: string;
  severity: string;
  narrative: string;
  relatedRequestId: string;
  requestedForGroupDn: string;
  joinGroupDn: string;
}

export type StructuredTicketValues = TicketFormValues;
