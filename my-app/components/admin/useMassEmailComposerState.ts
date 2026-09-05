import { useMemo, useReducer } from 'react';
import {
  composerReducer,
  composerSetter,
  INITIAL_COMPOSER_STATE,
} from './massEmailComposerState';

export function useMassEmailComposerState() {
  const [composerState, dispatchComposer] = useReducer(
    composerReducer,
    INITIAL_COMPOSER_STATE,
  );
  const setters = useMemo(
    () => ({
      editorMode: composerSetter(dispatchComposer, 'editorMode'),
      subject: composerSetter(dispatchComposer, 'subject'),
      html: composerSetter(dispatchComposer, 'html'),
      manualUsernames: composerSetter(dispatchComposer, 'manualUsernames'),
      recipientQuery: composerSetter(dispatchComposer, 'recipientQuery'),
      recipientResults: composerSetter(dispatchComposer, 'recipientResults'),
      selectedRecipients: composerSetter(
        dispatchComposer,
        'selectedRecipients',
      ),
      includeAllDomainUsers: composerSetter(
        dispatchComposer,
        'includeAllDomainUsers',
      ),
      groupQuery: composerSetter(dispatchComposer, 'groupQuery'),
      groupResults: composerSetter(dispatchComposer, 'groupResults'),
      selectedGroups: composerSetter(dispatchComposer, 'selectedGroups'),
      previewHtml: composerSetter(dispatchComposer, 'previewHtml'),
      resolution: composerSetter(dispatchComposer, 'resolution'),
      previewSignature: composerSetter(dispatchComposer, 'previewSignature'),
      resolvedTargetsSignature: composerSetter(
        dispatchComposer,
        'resolvedTargetsSignature',
      ),
      previewDigest: composerSetter(dispatchComposer, 'previewDigest'),
      resolvedContentSignature: composerSetter(
        dispatchComposer,
        'resolvedContentSignature',
      ),
      selectedCampaignId: composerSetter(
        dispatchComposer,
        'selectedCampaignId',
      ),
      campaignDetailsById: composerSetter(
        dispatchComposer,
        'campaignDetailsById',
      ),
      loadingCampaignId: composerSetter(dispatchComposer, 'loadingCampaignId'),
      campaignAudienceQuery: composerSetter(
        dispatchComposer,
        'campaignAudienceQuery',
      ),
      campaignAudienceFilter: composerSetter(
        dispatchComposer,
        'campaignAudienceFilter',
      ),
      dryRunQuery: composerSetter(dispatchComposer, 'dryRunQuery'),
      editingCampaignId: composerSetter(dispatchComposer, 'editingCampaignId'),
      testEmail: composerSetter(dispatchComposer, 'testEmail'),
      isWorking: composerSetter(dispatchComposer, 'isWorking'),
      isSearchingRecipients: composerSetter(
        dispatchComposer,
        'isSearchingRecipients',
      ),
      isSearchingGroups: composerSetter(dispatchComposer, 'isSearchingGroups'),
      hasSearchedRecipients: composerSetter(
        dispatchComposer,
        'hasSearchedRecipients',
      ),
      hasSearchedGroups: composerSetter(dispatchComposer, 'hasSearchedGroups'),
    }),
    [],
  );
  return { composerState, dispatchComposer, setters };
}
