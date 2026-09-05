'use client';

import { useCallback, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { createMassEmailDraftActions } from './massEmailDraftActions';
import { useMassEmailComposerState } from './useMassEmailComposerState';
import { createMassEmailCampaignActions } from './massEmailCampaignActions';
import { useToast } from '@/hooks/useToast';
import Toast from '@/components/Toast';
import { MassEmailAudienceSelector } from './MassEmailAudienceSelector';
import { useMassEmailAudienceModel } from './MassEmailAudienceModel';
import { MassEmailCampaignDetail } from './MassEmailCampaignDetail';
import { MassEmailCampaignWorkspace } from './MassEmailCampaignWorkspace';
import { useMassEmailCampaignPolling } from './MassEmailCampaignPolling';
import { MassEmailComposeEditor } from './MassEmailComposeEditor';
import { MassEmailDryRun } from './MassEmailDryRun';
import { MassEmailReviewActions } from './MassEmailReviewActions';
import { useMassEmailAudienceSearch } from './MassEmailAudienceSearch';
import type {
  ComposerTab,
  GroupOption,
  MassEmailCampaign,
  RecipientOption,
} from './MassEmailTypes';

interface MassEmailComposerProps {
  activeWorkspace?: ComposerTab;
  onWorkspaceChange?: (workspace: ComposerTab) => void;
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

export default function MassEmailComposer({
  activeWorkspace,
  onWorkspaceChange,
}: MassEmailComposerProps = {}) {
  const { toast, showToast, hideToast } = useToast();
  const [internalComposerTab, setInternalComposerTab] =
    useState<ComposerTab>('compose');
  const activeComposerTab = activeWorkspace ?? internalComposerTab;
  const setActiveComposerTab = useCallback(
    (workspace: ComposerTab) => {
      setInternalComposerTab(workspace);
      onWorkspaceChange?.(workspace);
    },
    [onWorkspaceChange],
  );
  const { composerState, dispatchComposer, setters } =
    useMassEmailComposerState();

  const {
    campaignsData,
    isLoading,
    refresh,
    lastUpdated,
    fetchCampaignDetail,
    selectCampaign,
  } = useMassEmailCampaignPolling({
    selectedCampaignId: composerState.selectedCampaignId,
    campaignDetailsById: composerState.campaignDetailsById,
    loadingCampaignId: composerState.loadingCampaignId,
    dispatch: dispatchComposer,
  });
  const {
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
  } = useMassEmailAudienceModel({
    subject: composerState.subject,
    html: composerState.html,
    manualUsernames: composerState.manualUsernames,
    selectedRecipients: composerState.selectedRecipients,
    includeAllDomainUsers: composerState.includeAllDomainUsers,
    selectedGroups: composerState.selectedGroups,
    resolution: composerState.resolution,
    previewSignature: composerState.previewSignature,
    resolvedTargetsSignature: composerState.resolvedTargetsSignature,
    previewDigest: composerState.previewDigest,
    resolvedContentSignature: composerState.resolvedContentSignature,
    dryRunQuery: composerState.dryRunQuery,
    campaignsData,
    selectedCampaignId: composerState.selectedCampaignId,
    campaignDetailsById: composerState.campaignDetailsById,
    loadingCampaignId: composerState.loadingCampaignId,
    campaignAudienceQuery: composerState.campaignAudienceQuery,
    campaignAudienceFilter: composerState.campaignAudienceFilter,
  });

  const rememberCampaignDetail = useCallback(
    (campaign: MassEmailCampaign | null | undefined) => {
      if (!campaign?.id) return;
      dispatchComposer({ type: 'campaignDetailLoaded', campaign });
    },
    [dispatchComposer],
  );

  const { reconcileRecipient, campaignAction } = createMassEmailCampaignActions(
    {
      setIsWorking: setters.isWorking,
      setCampaignDetailsById: setters.campaignDetailsById,
      fetchCampaignDetail,
      refresh,
      showToast,
      rememberCampaignDetail,
    },
  );

  const { searchGroups, searchRecipients } = useMassEmailAudienceSearch({
    groupQuery: composerState.groupQuery,
    recipientQuery: composerState.recipientQuery,
    targetUsernames,
    setGroupResults: setters.groupResults,
    setRecipientResults: setters.recipientResults,
    setIsSearchingGroups: setters.isSearchingGroups,
    setIsSearchingRecipients: setters.isSearchingRecipients,
    setHasSearchedGroups: setters.hasSearchedGroups,
    setHasSearchedRecipients: setters.hasSearchedRecipients,
    showToast,
  });

  const addRecipient = (recipient: RecipientOption) => {
    const username = recipient.username.trim();
    if (!username) return;
    const exists = targetUsernames.some(
      (selectedUsername) =>
        normalizeUsername(selectedUsername) === normalizeUsername(username),
    );
    if (exists) {
      showToast('Recipient already selected', 'error');
      return;
    }
    setters.selectedRecipients((current) => [...current, recipient]);
  };

  const removeRecipient = (username: string) => {
    setters.selectedRecipients((current) =>
      current.filter(
        (recipient) =>
          normalizeUsername(recipient.username) !== normalizeUsername(username),
      ),
    );
  };

  const addGroup = (group: GroupOption) => {
    setters.selectedGroups((current) =>
      current.some((item) => item.dn === group.dn)
        ? current
        : [...current, group],
    );
  };

  const {
    runPreview,
    runDryRun,
    saveDraft,
    quickSend,
    sendTest,
    loadDraftForEditing,
    cancelDraftEdit,
  } = createMassEmailDraftActions({
    subject: composerState.subject,
    html: composerState.html,
    targets,
    currentPreviewSignature,
    currentTargetsSignature,
    resolutionIsFresh,
    resolution: composerState.resolution,
    previewDigest: composerState.previewDigest,
    editingCampaignId: composerState.editingCampaignId,
    testEmail: composerState.testEmail,
    setIsWorking: setters.isWorking,
    dispatchComposer,
    setActiveComposerTab,
    showToast,
    refresh,
    setEditingCampaignId: setters.editingCampaignId,
  });

  return (
    <Tabs
      value={activeComposerTab}
      onValueChange={(value) => setActiveComposerTab(value as ComposerTab)}
      className="space-y-5"
    >
      <Toast
        message={toast.message}
        type={toast.type}
        isVisible={toast.isVisible}
        onClose={hideToast}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <TabsList>
          <TabsTrigger value="compose">Compose</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns</TabsTrigger>
        </TabsList>
        <div className="rounded-full border bg-muted/50 px-3 py-1 text-xs font-medium text-muted-foreground">
          {audienceSummary}
        </div>
      </div>

      <TabsContent value="compose" className="space-y-6">
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(340px,420px)] xl:items-start">
          <div className="space-y-5">
            <MassEmailComposeEditor
              editingCampaignId={composerState.editingCampaignId}
              editingCampaignSubject={selectedCampaign?.subject}
              subject={composerState.subject}
              html={composerState.html}
              editorMode={composerState.editorMode}
              onCancelEdit={cancelDraftEdit}
              onSubjectChange={setters.subject}
              onEditorModeChange={setters.editorMode}
              onHtmlChange={setters.html}
              showToast={showToast}
            />
            <MassEmailAudienceSelector
              audienceSummary={audienceSummary}
              includeAllDomainUsers={composerState.includeAllDomainUsers}
              recipientQuery={composerState.recipientQuery}
              recipientResults={composerState.recipientResults}
              selectedRecipients={composerState.selectedRecipients}
              manualUsernames={composerState.manualUsernames}
              groupQuery={composerState.groupQuery}
              groupResults={composerState.groupResults}
              selectedGroups={composerState.selectedGroups}
              recipientSearch={{
                isSearching: composerState.isSearchingRecipients,
                hasSearched: composerState.hasSearchedRecipients,
              }}
              groupSearch={{
                isSearching: composerState.isSearchingGroups,
                hasSearched: composerState.hasSearchedGroups,
              }}
              onIncludeAllDomainUsersChange={setters.includeAllDomainUsers}
              onRecipientQueryChange={(value) => {
                setters.recipientQuery(value);
                setters.hasSearchedRecipients(false);
              }}
              onGroupQueryChange={(value) => {
                setters.groupQuery(value);
                setters.hasSearchedGroups(false);
              }}
              onManualUsernamesChange={setters.manualUsernames}
              onSearchRecipients={searchRecipients}
              onSearchGroups={searchGroups}
              onAddRecipient={addRecipient}
              onRemoveRecipient={removeRecipient}
              onAddGroup={addGroup}
              onRemoveGroup={(dn) =>
                setters.selectedGroups((current) =>
                  current.filter((group) => group.dn !== dn),
                )
              }
            />
          </div>
          <MassEmailReviewActions
            previewHtml={composerState.previewHtml}
            previewIsFresh={previewIsFresh}
            testEmail={composerState.testEmail}
            editingCampaignId={composerState.editingCampaignId}
            isWorking={composerState.isWorking}
            resolutionIsFresh={resolutionIsFresh}
            onPreview={runPreview}
            onDryRun={runDryRun}
            onTestEmailChange={setters.testEmail}
            onSendTest={sendTest}
            onSaveDraft={saveDraft}
            onQuickSend={quickSend}
          />
        </div>
        <MassEmailDryRun
          resolution={composerState.resolution}
          resolutionIsFresh={resolutionIsFresh}
          dryRunQuery={composerState.dryRunQuery}
          filteredCandidates={filteredDryRunCandidates}
          filteredRecipients={filteredDryRunRecipients}
          filteredSkipped={filteredDryRunSkipped}
          candidateCount={dryRunCandidates.length}
          onDryRunQueryChange={setters.dryRunQuery}
        />
      </TabsContent>

      <TabsContent value="campaigns" className="space-y-4">
        <MassEmailCampaignWorkspace
          campaigns={campaigns}
          selectedCampaignId={effectiveSelectedCampaignId}
          onSelectCampaign={selectCampaign}
          lastUpdated={lastUpdated}
          isLoading={isLoading}
          refresh={refresh}
        >
          <MassEmailCampaignDetail
            campaign={selectedCampaign}
            audienceRows={selectedCampaignAudience}
            filteredAudienceRows={filteredCampaignAudience}
            audienceCounts={campaignAudienceCounts}
            audienceQuery={composerState.campaignAudienceQuery}
            audienceFilter={composerState.campaignAudienceFilter}
            isLoading={isSelectedCampaignDetailLoading}
            isWorking={composerState.isWorking}
            onEditDraft={loadDraftForEditing}
            onCampaignAction={campaignAction}
            onAudienceQueryChange={setters.campaignAudienceQuery}
            onAudienceFilterChange={setters.campaignAudienceFilter}
            onReconcileRecipient={reconcileRecipient}
          />
        </MassEmailCampaignWorkspace>
      </TabsContent>
    </Tabs>
  );
}
