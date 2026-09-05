import { useMemo } from 'react';
import type {
  CampaignAudienceFilter,
  CampaignAudienceRow,
  GroupOption,
  MassEmailCampaign,
  RecipientOption,
  ResolutionListItem,
  ResolutionResponse,
} from './MassEmailTypes';
import {
  formatReason,
  normalizeSources,
  sourceSummary,
} from './MassEmailViewUtils';

interface CampaignsData {
  campaigns: MassEmailCampaign[];
  selectedCampaign: MassEmailCampaign | null;
}

interface MassEmailAudienceModelProps {
  subject: string;
  html: string;
  manualUsernames: string[];
  selectedRecipients: RecipientOption[];
  includeAllDomainUsers: boolean;
  selectedGroups: GroupOption[];
  resolution: ResolutionResponse | null;
  previewSignature: string | null;
  resolvedTargetsSignature: string | null;
  previewDigest: string | null;
  resolvedContentSignature: string | null;
  dryRunQuery: string;
  campaignsData: CampaignsData | null | undefined;
  selectedCampaignId: string | null;
  campaignDetailsById: Record<string, MassEmailCampaign>;
  loadingCampaignId: string | null;
  campaignAudienceQuery: string;
  campaignAudienceFilter: CampaignAudienceFilter;
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}
function uniqueUsernames(usernames: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const username of usernames) {
    const normalized = normalizeUsername(username);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(username.trim());
  }
  return result;
}
function audienceRows(
  campaign: MassEmailCampaign | null,
): CampaignAudienceRow[] {
  if (!campaign) return [];
  const eligibleRows = (campaign.recipients || []).map((recipient) => ({
    key: `eligible-${recipient.id}`,
    recipientId: recipient.id,
    type: 'eligible' as const,
    displayName: recipient.displayName,
    email: recipient.email,
    adUsername: recipient.adUsername,
    status: recipient.status,
    sourceText: sourceSummary(normalizeSources(recipient.sources)),
    note: recipient.lastError || undefined,
    sentAt: recipient.sentAt,
  }));
  const skippedRows = (campaign.targetSnapshot?.skipped || []).map(
    (recipient, index) => ({
      key: `skipped-${recipient.email || recipient.adUsername || index}`,
      type: 'skipped' as const,
      displayName: recipient.displayName,
      email: recipient.email || null,
      adUsername: recipient.adUsername || null,
      status: 'skipped',
      sourceText: sourceSummary(normalizeSources(recipient.sources)),
      note: formatReason(recipient.reason),
    }),
  );
  return [...eligibleRows, ...skippedRows];
}
function resolutionMatches(item: ResolutionListItem, query: string) {
  if (!query) return true;
  return [
    item.displayName,
    item.email,
    item.adUsername,
    item.reason,
    sourceSummary(item.sources),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .includes(query);
}

export function useMassEmailAudienceModel(props: MassEmailAudienceModelProps) {
  const targetUsernames = useMemo(
    () =>
      uniqueUsernames([
        ...props.manualUsernames,
        ...props.selectedRecipients.map((recipient) => recipient.username),
      ]),
    [props.manualUsernames, props.selectedRecipients],
  );
  const audienceSummary = useMemo(() => {
    const parts: string[] = [];
    if (props.includeAllDomainUsers) parts.push('All AD users');
    if (targetUsernames.length > 0)
      parts.push(`${targetUsernames.length} recipients`);
    if (props.selectedGroups.length > 0)
      parts.push(`${props.selectedGroups.length} groups`);
    return parts.length > 0 ? parts.join(' + ') : 'No audience selected';
  }, [
    props.includeAllDomainUsers,
    props.selectedGroups.length,
    targetUsernames.length,
  ]);
  const targets = useMemo(
    () => ({
      selectedUsernames: targetUsernames,
      selectedGroups: props.selectedGroups.map((group) => ({
        dn: group.dn,
        name: group.name,
      })),
      includeAllDomainUsers: props.includeAllDomainUsers,
    }),
    [props.includeAllDomainUsers, props.selectedGroups, targetUsernames],
  );
  const currentPreviewSignature = useMemo(
    () => JSON.stringify({ subject: props.subject, html: props.html }),
    [props.html, props.subject],
  );
  const currentTargetsSignature = useMemo(
    () => JSON.stringify(targets),
    [targets],
  );
  const previewIsFresh = props.previewSignature === currentPreviewSignature;
  const resolutionIsFresh =
    Boolean(props.resolution && props.previewDigest) &&
    props.resolvedTargetsSignature === currentTargetsSignature &&
    props.resolvedContentSignature === currentPreviewSignature;
  const dryRunCandidates = useMemo(
    () =>
      !props.resolution
        ? []
        : props.resolution.candidates?.length > 0
          ? props.resolution.candidates
          : [...props.resolution.recipients, ...props.resolution.skipped],
    [props.resolution],
  );
  const query = props.dryRunQuery.trim().toLowerCase();
  const filteredDryRunCandidates = useMemo(
    () => dryRunCandidates.filter((item) => resolutionMatches(item, query)),
    [dryRunCandidates, query],
  );
  const filteredDryRunRecipients = useMemo(
    () =>
      (props.resolution?.recipients || []).filter((item) =>
        resolutionMatches(item, query),
      ),
    [props.resolution?.recipients, query],
  );
  const filteredDryRunSkipped = useMemo(
    () =>
      (props.resolution?.skipped || []).filter((item) =>
        resolutionMatches(item, query),
      ),
    [props.resolution?.skipped, query],
  );
  const campaigns = props.campaignsData?.campaigns || [];
  const effectiveSelectedCampaignId =
    props.selectedCampaignId ||
    props.campaignsData?.selectedCampaign?.id ||
    campaigns[0]?.id ||
    null;
  const selectedCampaignSummary =
    campaigns.find((campaign) => campaign.id === effectiveSelectedCampaignId) ||
    null;
  const selectedCampaignDetail = effectiveSelectedCampaignId
    ? props.campaignDetailsById[effectiveSelectedCampaignId] || null
    : null;
  const selectedCampaign =
    selectedCampaignDetail || selectedCampaignSummary || null;
  const isSelectedCampaignDetailLoading =
    props.loadingCampaignId === effectiveSelectedCampaignId &&
    !selectedCampaignDetail;
  const selectedCampaignAudience = useMemo(
    () => audienceRows(selectedCampaign),
    [selectedCampaign],
  );
  const campaignAudienceCounts = useMemo(
    () => ({
      all: selectedCampaignAudience.length,
      eligible: selectedCampaignAudience.filter(
        (row) => row.type === 'eligible',
      ).length,
      skipped: selectedCampaignAudience.filter((row) => row.type === 'skipped')
        .length,
      sent: selectedCampaignAudience.filter((row) => row.status === 'sent')
        .length,
      failed: selectedCampaignAudience.filter((row) => row.status === 'failed')
        .length,
      delivery_unknown: selectedCampaignAudience.filter(
        (row) => row.status === 'delivery_unknown',
      ).length,
    }),
    [selectedCampaignAudience],
  );
  const filteredCampaignAudience = useMemo(() => {
    const audienceQuery = props.campaignAudienceQuery.trim().toLowerCase();
    return selectedCampaignAudience.filter(
      (row) =>
        (props.campaignAudienceFilter === 'all' ||
          (props.campaignAudienceFilter === 'eligible' &&
            row.type === 'eligible') ||
          (props.campaignAudienceFilter === 'skipped' &&
            row.type === 'skipped') ||
          row.status === props.campaignAudienceFilter) &&
        (!audienceQuery ||
          [
            row.displayName,
            row.email,
            row.adUsername,
            row.status,
            row.sourceText,
            row.note,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
            .includes(audienceQuery)),
    );
  }, [
    props.campaignAudienceFilter,
    props.campaignAudienceQuery,
    selectedCampaignAudience,
  ]);
  return {
    targetUsernames,
    audienceSummary,
    targets,
    currentPreviewSignature,
    currentTargetsSignature,
    previewIsFresh,
    resolutionIsFresh,
    dryRunCandidates,
    filteredDryRunCandidates,
    filteredDryRunRecipients,
    filteredDryRunSkipped,
    campaigns,
    effectiveSelectedCampaignId,
    selectedCampaign,
    isSelectedCampaignDetailLoading,
    selectedCampaignAudience,
    campaignAudienceCounts,
    filteredCampaignAudience,
  };
}
