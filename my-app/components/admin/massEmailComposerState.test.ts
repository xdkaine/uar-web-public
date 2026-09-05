import { expect, it } from 'vitest';
import { composerReducer, INITIAL_COMPOSER_STATE } from './massEmailComposerState';
import type { MassEmailCampaign } from './MassEmailTypes';

const campaign: MassEmailCampaign = { id: 'fixture-campaign', subject: 'Synthetic subject', html: '<p>Synthetic body</p>', status: 'draft', quickSend: false, createdAt: '', createdBy: '', eligibleRecipients: 1, skippedRecipients: 0, sentCount: 0, failedCount: 0 };

it('saves one returned campaign and selects it without losing other cached campaigns', () => {
  const prior = { ...INITIAL_COMPOSER_STATE, editingCampaignId: 'old', campaignDetailsById: { other: { ...campaign, id: 'other' } } };
  const next = composerReducer(prior, { type: 'campaignSaved', campaign });
  expect(next.selectedCampaignId).toBe(campaign.id);
  expect(next.editingCampaignId).toBeNull();
  expect(next.campaignDetailsById.other).toBe(prior.campaignDetailsById.other);
  expect(next.campaignDetailsById[campaign.id]).toBe(campaign);
});

it('keeps detail fields on a partial poll and replaces fields present in that poll', () => {
  const detail = { ...campaign, recipients: [{ id: 'recipient', email: 'synthetic@example.test', status: 'pending' }], logs: [], targetSnapshot: { targets: { selectedUsernames: ['synthetic'] } } };
  const prior = { ...INITIAL_COMPOSER_STATE, campaignDetailsById: { [campaign.id]: detail } };
  const next = composerReducer(prior, { type: 'pollCampaignSynced', campaign: { ...campaign, status: 'active' } });
  expect(next.campaignDetailsById[campaign.id]).toEqual({ ...detail, status: 'active' });
  const refreshed = composerReducer(next, { type: 'pollCampaignSynced', campaign: { ...campaign, recipients: [{ id: 'recipient', email: 'synthetic@example.test', status: 'sent' }] } });
  expect(refreshed.campaignDetailsById[campaign.id].recipients?.[0].status).toBe('sent');
});

it('loads the draft and resets stale send evidence together while preserving unrelated form choices', () => {
  const prior = { ...INITIAL_COMPOSER_STATE, previewDigest: 'old', resolvedTargetsSignature: 'old', dryRunQuery: 'old', testEmail: 'test@example.test', campaignAudienceQuery: 'search', selectedRecipients: [{ username: 'old' }] };
  const next = composerReducer(prior, { type: 'draftLoaded', campaign, html: '<p>Editable content</p>', manualUsernames: ['synthetic'], includeAllDomainUsers: true, selectedGroups: [{ dn: 'synthetic-dn', name: 'Synthetic group' }] });
  expect(next).toMatchObject({ editingCampaignId: campaign.id, subject: campaign.subject, html: '<p>Editable content</p>', previewHtml: campaign.html, manualUsernames: ['synthetic'], includeAllDomainUsers: true, selectedRecipients: [], selectedGroups: [{ dn: 'synthetic-dn', name: 'Synthetic group' }], resolution: null, resolvedTargetsSignature: null, previewDigest: null, dryRunQuery: '', editorMode: 'visual', testEmail: 'test@example.test', campaignAudienceQuery: 'search' });
  expect(next.previewSignature).toBe(JSON.stringify({ subject: campaign.subject, html: '<p>Editable content</p>' }));
});

it('ignores an old detail completion when another campaign is loading', () => {
  const prior = { ...INITIAL_COMPOSER_STATE, loadingCampaignId: 'new' };
  expect(composerReducer(prior, { type: 'campaignDetailFinished', campaignId: 'old' }).loadingCampaignId).toBe('new');
});
