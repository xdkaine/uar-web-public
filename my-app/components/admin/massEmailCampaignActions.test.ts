import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createMassEmailCampaignActions } from './massEmailCampaignActions';
import type { MassEmailCampaign } from './MassEmailTypes';

const { fetchWithCsrf } = vi.hoisted(() => ({ fetchWithCsrf: vi.fn() }));
vi.mock('@/lib/csrf', () => ({ fetchWithCsrf }));

const campaign: MassEmailCampaign = { id: 'synthetic-campaign', subject: 'Synthetic campaign', status: 'active', quickSend: false, createdAt: '', createdBy: '', eligibleRecipients: 1, skippedRecipients: 0, sentCount: 0, failedCount: 0 };
const prompt = vi.fn();
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('window', { prompt }); });
afterEach(() => vi.unstubAllGlobals());

function setup() {
  let details = { [campaign.id]: campaign, other: { ...campaign, id: 'other' } };
  const context = {
    setIsWorking: vi.fn(),
    setCampaignDetailsById: vi.fn((update) => { details = typeof update === 'function' ? update(details) : update; }),
    fetchCampaignDetail: vi.fn(async () => {}),
    refresh: vi.fn(async () => {}),
    showToast: vi.fn(),
    rememberCampaignDetail: vi.fn(),
  };
  return { context, actions: createMassEmailCampaignActions(context), details: () => details };
}

it.each(['activate', 'process', 'cancel'] as const)('preserves the exact %s target and updates the returned campaign before refresh', async (action) => {
  const { context, actions } = setup();
  fetchWithCsrf.mockResolvedValue(new Response(JSON.stringify({ campaign })));
  await actions.campaignAction(campaign.id, action);
  expect(fetchWithCsrf).toHaveBeenCalledWith(`/api/admin/mass-email/${campaign.id}/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  expect(context.rememberCampaignDetail).toHaveBeenCalledWith(campaign);
  expect(context.rememberCampaignDetail.mock.invocationCallOrder[0]).toBeLessThan(context.refresh.mock.invocationCallOrder[0]);
  expect(context.fetchCampaignDetail).not.toHaveBeenCalled();
  expect(context.setIsWorking.mock.calls).toEqual([[true], [false]]);
});

it('displays failure and releases busy state without pretending the campaign changed', async () => {
  const { context, actions } = setup();
  fetchWithCsrf.mockResolvedValue(new Response(JSON.stringify({ error: 'Synthetic failure' }), { status: 500 }));
  await actions.campaignAction(campaign.id, 'cancel');
  expect(context.showToast).toHaveBeenCalledWith('Synthetic failure', 'error');
  expect(context.refresh).not.toHaveBeenCalled();
  expect(context.rememberCampaignDetail).not.toHaveBeenCalled();
  expect(context.setIsWorking.mock.calls).toEqual([[true], [false]]);
});

it('does not reconcile without operator evidence', async () => {
  const { actions, context } = setup();
  prompt.mockReturnValue(null);
  await actions.reconcileRecipient(campaign.id, 'recipient', 'not_delivered');
  expect(fetchWithCsrf).not.toHaveBeenCalled();
  expect(context.setIsWorking).not.toHaveBeenCalled();
});

it.each(['delivered', 'not_delivered'] as const)('preserves %s evidence and invalidates only the affected campaign', async (resolution) => {
  const { actions, context, details } = setup();
  prompt.mockReturnValue('  Synthetic operator evidence  ');
  fetchWithCsrf.mockResolvedValue(new Response('{}'));
  await actions.reconcileRecipient(campaign.id, 'recipient/one', resolution);
  expect(fetchWithCsrf).toHaveBeenCalledWith(`/api/admin/mass-email/${campaign.id}/recipients/recipient%2Fone/reconcile`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ resolution, evidence: 'Synthetic operator evidence' }) });
  expect(Object.keys(details())).toEqual(['other']);
  expect(context.fetchCampaignDetail).toHaveBeenCalledWith(campaign.id);
  expect(context.fetchCampaignDetail.mock.invocationCallOrder[0]).toBeLessThan(context.refresh.mock.invocationCallOrder[0]);
  expect(context.setIsWorking.mock.calls).toEqual([[true], [false]]);
});
