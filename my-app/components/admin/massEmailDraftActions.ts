import type { Dispatch } from 'react';
import type { ToastType } from '@/components/Toast';
import { requestActionImpact } from './actionImpactRequest';
import { callJson } from './massEmailApi';
import type { ComposerAction } from './massEmailComposerState';
import type {
  ComposerTab,
  MassEmailCampaign,
  ResolutionResponse,
} from './MassEmailTypes';

interface DraftActionContext {
  subject: string;
  html: string;
  targets: {
    selectedUsernames: string[];
    selectedGroups: { dn: string; name: string }[];
    includeAllDomainUsers: boolean;
  };
  currentPreviewSignature: string;
  currentTargetsSignature: string;
  resolutionIsFresh: boolean;
  resolution: ResolutionResponse | null;
  previewDigest: string | null;
  editingCampaignId: string | null;
  testEmail: string;
  setIsWorking: (working: boolean) => void;
  dispatchComposer: Dispatch<ComposerAction>;
  setActiveComposerTab: (tab: ComposerTab) => void;
  showToast: (message: string, type: ToastType) => void;
  refresh: () => Promise<void>;
  setEditingCampaignId: (id: string | null) => void;
}

// A captured draft, its preview evidence, and the commands that can save/send it.
export function createMassEmailDraftActions({
  subject,
  html,
  targets,
  currentPreviewSignature,
  currentTargetsSignature,
  resolutionIsFresh,
  resolution,
  previewDigest,
  editingCampaignId,
  testEmail,
  setIsWorking,
  dispatchComposer,
  setActiveComposerTab,
  showToast,
  refresh,
  setEditingCampaignId,
}: DraftActionContext) {
  const runPreview = async () => {
    setIsWorking(true);
    try {
      const data = await callJson('/api/admin/mass-email/preview', {
        subject,
        html,
      });
      dispatchComposer({
        type: 'previewResolved',
        html: data.preview.html,
        signature: currentPreviewSignature,
      });
      showToast('Preview refreshed', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Preview failed',
        'error',
      );
    } finally {
      setIsWorking(false);
    }
  };

  const runDryRun = async () => {
    setIsWorking(true);
    try {
      const data = await callJson('/api/admin/mass-email/resolve', {
        targets,
        subject,
        html,
      });
      dispatchComposer({
        type: 'dryRunResolved',
        resolution: data.resolution,
        targetsSignature: currentTargetsSignature,
        previewDigest: data.previewDigest,
        contentSignature: currentPreviewSignature,
      });
      showToast(
        `Resolved ${data.resolution.summary.eligibleRecipients} recipients`,
        'success',
      );
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Recipient dry run failed',
        'error',
      );
    } finally {
      setIsWorking(false);
    }
  };

  const saveDraft = async () => {
    setIsWorking(true);
    try {
      const data = await callJson(
        editingCampaignId
          ? `/api/admin/mass-email/${editingCampaignId}`
          : '/api/admin/mass-email',
        { subject, html, targets },
        editingCampaignId ? 'PUT' : 'POST',
      );
      dispatchComposer({
        type: 'campaignSaved',
        campaign: data.campaign as MassEmailCampaign,
      });
      setActiveComposerTab('campaigns');
      showToast(
        editingCampaignId
          ? 'Mass email draft updated'
          : 'Mass email draft created',
        'success',
      );
      await refresh();
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : editingCampaignId
            ? 'Draft update failed'
            : 'Draft creation failed',
        'error',
      );
    } finally {
      setIsWorking(false);
    }
  };

  const quickSend = async () => {
    if (!resolutionIsFresh || !resolution) {
      showToast('Run a fresh audience dry run before quick-send', 'error');
      return;
    }
    const countText = `${resolution.summary.eligibleRecipients} resolved recipients`;
    const decision = await requestActionImpact({
      title: 'Start quick-send',
      description: `Send this message to ${countText}. Delivery begins immediately.`,
      items: [
        { label: 'Recipients', value: countText },
        {
          label: 'External effect',
          value: 'SMTP delivery begins immediately',
          tone: 'warning',
        },
      ],
      confirmLabel: 'Start sending',
      destructive: true,
      evidence:
        'Each delivery outcome is retained in campaign and audit evidence.',
    });
    if (!decision.confirmed) return;
    setIsWorking(true);
    try {
      const data = await callJson('/api/admin/mass-email/quick-send', {
        subject,
        html,
        targets,
        previewDigest,
      });
      dispatchComposer({
        type: 'campaignSaved',
        campaign: data.campaign as MassEmailCampaign,
      });
      setActiveComposerTab('campaigns');
      showToast(
        data.partial
          ? `Quick-send needs review: ${data.initialWave?.sent || 0} sent, ${data.initialWave?.failed || 0} failed in the initial wave.`
          : `Quick-send started: ${data.initialWave?.sent || 0} sent in the initial wave.`,
        data.partial ? 'warning' : 'success',
      );
      await refresh();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Quick-send failed',
        'error',
      );
    } finally {
      setIsWorking(false);
    }
  };

  const sendTest = async () => {
    setIsWorking(true);
    try {
      await callJson('/api/admin/mass-email/test', {
        to: testEmail,
        subject,
        html,
      });
      showToast('Test email sent', 'success');
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Test email failed',
        'error',
      );
    } finally {
      setIsWorking(false);
    }
  };

  const loadDraftForEditing = (campaign: MassEmailCampaign) => {
    if (campaign.status !== 'draft') return;
    const targetsSnapshot = campaign.targetSnapshot?.targets;
    const draftHtml = stripPortalFooter(campaign.html || '');
    dispatchComposer({
      type: 'draftLoaded',
      campaign,
      html: draftHtml,
      manualUsernames: targetsSnapshot?.selectedUsernames || [],
      includeAllDomainUsers: Boolean(targetsSnapshot?.includeAllDomainUsers),
      selectedGroups: (targetsSnapshot?.selectedGroups || []).map((group) => ({
        dn: group.dn,
        name: group.name || group.dn,
      })),
    });
    setActiveComposerTab('compose');
  };

  const cancelDraftEdit = () => {
    setEditingCampaignId(null);
    setActiveComposerTab('campaigns');
  };
  return {
    runPreview,
    runDryRun,
    saveDraft,
    quickSend,
    sendTest,
    loadDraftForEditing,
    cancelDraftEdit,
  };
}

function stripPortalFooter(rawHtml: string) {
  const html = rawHtml || '';
  const markerIndex = [
    'data-mass-email-footer="true"',
    "data-mass-email-footer='true'",
    'This message was submitted by the Cal Poly SOC UAR Portal.',
    'administrator-selected UAR Portal recipient audience.',
  ]
    .map((marker) => html.indexOf(marker))
    .filter((index) => index !== -1)
    .sort((left, right) => left - right)[0];
  if (markerIndex === -1) return rawHtml || '';

  const contentBeforeMarker = html.slice(0, markerIndex);
  const footerStart = contentBeforeMarker.lastIndexOf('<hr');
  return (
    footerStart === -1 ? contentBeforeMarker : html.slice(0, footerStart)
  ).trim();
}
