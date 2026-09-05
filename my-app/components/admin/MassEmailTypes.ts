export interface GroupOption {
  dn: string;
  name: string;
  description?: string;
}

export interface RecipientOption {
  username: string;
  displayName?: string | null;
  email?: string | null;
  accountEnabled?: boolean;
  dn?: string;
}

export interface ResolutionSource {
  label: string;
  type: string;
}

export interface MassEmailRecipient {
  id: string;
  email: string;
  displayName?: string | null;
  adUsername?: string | null;
  status: string;
  sources?: ResolutionSource[] | null;
  sentAt?: string | null;
  lastError?: string | null;
}

export interface MassEmailLog {
  id: string;
  createdAt: string;
  level: string;
  eventType: string;
  message: string;
}

export interface MassEmailCampaign {
  id: string;
  subject: string;
  html?: string;
  text?: string;
  status: string;
  quickSend: boolean;
  createdAt: string;
  createdBy: string;
  totalRecipients?: number;
  eligibleRecipients: number;
  skippedRecipients: number;
  sentCount: number;
  failedCount: number;
  statusCounts?: Record<string, number>;
  recipients?: MassEmailRecipient[];
  logs?: MassEmailLog[];
  targetSnapshot?: {
    targets?: {
      selectedUsernames?: string[];
      selectedGroups?: Array<{ dn: string; name?: string }>;
      includeAllDomainUsers?: boolean;
    };
    skipped?: Array<{
      email?: string;
      displayName?: string | null;
      adUsername?: string | null;
      reason: string;
      sources?: ResolutionSource[];
    }>;
  } | null;
}

export type CampaignAudienceFilter = 'all' | 'eligible' | 'skipped' | 'sent' | 'failed' | 'delivery_unknown';
export type ComposerTab = 'compose' | 'campaigns';
export type EditorMode = 'visual' | 'html';

export interface CampaignAudienceRow {
  key: string;
  recipientId?: string;
  type: 'eligible' | 'skipped';
  displayName?: string | null;
  email?: string | null;
  adUsername?: string | null;
  status: string;
  sourceText: string;
  note?: string;
  sentAt?: string | null;
}

export interface ResolutionListItem {
  email?: string;
  displayName?: string | null;
  adUsername?: string | null;
  accountEnabled?: boolean | null;
  reason?: string;
  sources: ResolutionSource[];
}

export interface ResolutionResponse {
  candidates: ResolutionListItem[];
  recipients: ResolutionListItem[];
  skipped: ResolutionListItem[];
  summary: {
    totalCandidates: number;
    eligibleRecipients: number;
    skippedRecipients: number;
    duplicateSourcesMerged: number;
  };
}
