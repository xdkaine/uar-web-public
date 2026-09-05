import type { Dispatch, SetStateAction } from 'react';
import type {
  CampaignAudienceFilter,
  EditorMode,
  GroupOption,
  MassEmailCampaign,
  RecipientOption,
  ResolutionResponse,
} from './MassEmailTypes';

export interface ComposerState {
  editorMode: EditorMode;
  subject: string;
  html: string;
  manualUsernames: string[];
  recipientQuery: string;
  recipientResults: RecipientOption[];
  selectedRecipients: RecipientOption[];
  includeAllDomainUsers: boolean;
  groupQuery: string;
  groupResults: GroupOption[];
  selectedGroups: GroupOption[];
  previewHtml: string;
  resolution: ResolutionResponse | null;
  previewSignature: string | null;
  resolvedTargetsSignature: string | null;
  previewDigest: string | null;
  resolvedContentSignature: string | null;
  selectedCampaignId: string | null;
  campaignDetailsById: Record<string, MassEmailCampaign>;
  loadingCampaignId: string | null;
  campaignAudienceQuery: string;
  campaignAudienceFilter: CampaignAudienceFilter;
  dryRunQuery: string;
  editingCampaignId: string | null;
  testEmail: string;
  isWorking: boolean;
  isSearchingRecipients: boolean;
  isSearchingGroups: boolean;
  hasSearchedRecipients: boolean;
  hasSearchedGroups: boolean;
}

export const INITIAL_COMPOSER_STATE: ComposerState = {
  editorMode: 'visual',
  subject: '',
  html: '<h2>Service Notice</h2>\n<p></p>',
  manualUsernames: [],
  recipientQuery: '',
  recipientResults: [],
  selectedRecipients: [],
  includeAllDomainUsers: false,
  groupQuery: '',
  groupResults: [],
  selectedGroups: [],
  previewHtml: '',
  resolution: null,
  previewSignature: null,
  resolvedTargetsSignature: null,
  previewDigest: null,
  resolvedContentSignature: null,
  selectedCampaignId: null,
  campaignDetailsById: {},
  loadingCampaignId: null,
  campaignAudienceQuery: '',
  campaignAudienceFilter: 'all',
  dryRunQuery: '',
  editingCampaignId: null,
  testEmail: '',
  isWorking: false,
  isSearchingRecipients: false,
  isSearchingGroups: false,
  hasSearchedRecipients: false,
  hasSearchedGroups: false,
};

export type ComposerAction =
  | {
      type: 'set';
      key: keyof ComposerState;
      value: SetStateAction<ComposerState[keyof ComposerState]>;
    }
  | { type: 'previewResolved'; html: string; signature: string }
  | {
      type: 'dryRunResolved';
      resolution: ResolutionResponse;
      targetsSignature: string;
      previewDigest: string;
      contentSignature: string;
    }
  | { type: 'campaignSelected'; campaignId: string }
  | { type: 'campaignDetailLoading'; campaignId: string }
  | { type: 'campaignDetailLoaded'; campaign: MassEmailCampaign }
  | { type: 'campaignDetailFinished'; campaignId: string }
  | { type: 'pollCampaignSynced'; campaign: MassEmailCampaign }
  | { type: 'campaignSaved'; campaign: MassEmailCampaign }
  | {
      type: 'draftLoaded';
      campaign: MassEmailCampaign;
      html: string;
      manualUsernames: string[];
      includeAllDomainUsers: boolean;
      selectedGroups: GroupOption[];
    };

export function composerReducer(
  state: ComposerState,
  action: ComposerAction,
): ComposerState {
  if (action.type === 'previewResolved')
    return {
      ...state,
      previewHtml: action.html,
      previewSignature: action.signature,
    };
  if (action.type === 'dryRunResolved')
    return {
      ...state,
      resolution: action.resolution,
      resolvedTargetsSignature: action.targetsSignature,
      previewDigest: action.previewDigest,
      resolvedContentSignature: action.contentSignature,
    };
  if (action.type === 'campaignSelected')
    return { ...state, selectedCampaignId: action.campaignId };
  if (action.type === 'campaignDetailLoading')
    return { ...state, loadingCampaignId: action.campaignId };
  if (action.type === 'campaignDetailLoaded')
    return {
      ...state,
      campaignDetailsById: {
        ...state.campaignDetailsById,
        [action.campaign.id]: action.campaign,
      },
    };
  if (action.type === 'campaignDetailFinished')
    return {
      ...state,
      loadingCampaignId:
        state.loadingCampaignId === action.campaignId
          ? null
          : state.loadingCampaignId,
    };
  if (action.type === 'pollCampaignSynced') {
    const existing = state.campaignDetailsById[action.campaign.id];
    const campaign = {
      ...existing,
      ...action.campaign,
      recipients: action.campaign.recipients ?? existing?.recipients,
      logs: action.campaign.logs ?? existing?.logs,
      targetSnapshot:
        action.campaign.targetSnapshot ?? existing?.targetSnapshot,
    };
    return {
      ...state,
      campaignDetailsById: {
        ...state.campaignDetailsById,
        [campaign.id]: campaign,
      },
    };
  }
  if (action.type === 'campaignSaved')
    return {
      ...state,
      campaignDetailsById: {
        ...state.campaignDetailsById,
        [action.campaign.id]: action.campaign,
      },
      selectedCampaignId: action.campaign.id,
      editingCampaignId: null,
    };
  if (action.type === 'draftLoaded')
    return {
      ...state,
      editingCampaignId: action.campaign.id,
      subject: action.campaign.subject,
      html: action.html,
      previewHtml: action.campaign.html || '',
      previewSignature: JSON.stringify({
        subject: action.campaign.subject,
        html: action.html,
      }),
      manualUsernames: action.manualUsernames,
      selectedRecipients: [],
      includeAllDomainUsers: action.includeAllDomainUsers,
      selectedGroups: action.selectedGroups,
      resolution: null,
      resolvedTargetsSignature: null,
      previewDigest: null,
      dryRunQuery: '',
      editorMode: 'visual',
    };
  const current = state[action.key];
  const value =
    typeof action.value === 'function'
      ? (action.value as (previous: typeof current) => typeof current)(current)
      : action.value;
  return { ...state, [action.key]: value } as ComposerState;
}

export function composerSetter<K extends keyof ComposerState>(
  dispatch: Dispatch<ComposerAction>,
  key: K,
) {
  return (value: SetStateAction<ComposerState[K]>) =>
    dispatch({
      type: 'set',
      key,
      value: value as SetStateAction<ComposerState[keyof ComposerState]>,
    });
}
