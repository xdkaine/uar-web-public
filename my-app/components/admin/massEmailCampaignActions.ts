import type { Dispatch, SetStateAction } from 'react';
import type { ToastType } from '@/components/Toast';
import type { MassEmailCampaign } from './MassEmailTypes';
import { callJson } from './massEmailApi';

interface CampaignActionContext {
  setIsWorking: (working: boolean) => void;
  setCampaignDetailsById: Dispatch<
    SetStateAction<Record<string, MassEmailCampaign>>
  >;
  fetchCampaignDetail: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
  showToast: (message: string, type: ToastType) => void;
  rememberCampaignDetail: (campaign: MassEmailCampaign) => void;
}

// Existing-campaign operations share cache invalidation and refresh ownership.
// Compose/preview freshness and the quick-send confirmation remain in the composer.
export function createMassEmailCampaignActions({
  setIsWorking,
  setCampaignDetailsById,
  fetchCampaignDetail,
  refresh,
  showToast,
  rememberCampaignDetail,
}: CampaignActionContext) {
  const reconcileRecipient = async (
    campaignId: string,
    recipientId: string,
    resolution: 'delivered' | 'not_delivered',
  ) => {
    const evidence = window
      .prompt(
        resolution === 'delivered'
          ? 'Enter provider or recipient evidence that delivery occurred.'
          : 'Enter provider evidence that delivery did not occur. This authorizes one retry.',
      )
      ?.trim();
    if (!evidence) return;
    setIsWorking(true);
    try {
      await callJson(
        `/api/admin/mass-email/${encodeURIComponent(campaignId)}/recipients/${encodeURIComponent(recipientId)}/reconcile`,
        { resolution, evidence },
      );
      setCampaignDetailsById((current) => {
        const next = { ...current };
        delete next[campaignId];
        return next;
      });
      await fetchCampaignDetail(campaignId);
      await refresh();
      showToast(
        resolution === 'delivered'
          ? 'Delivery recorded from operator evidence.'
          : 'Non-delivery recorded; one retry is queued.',
        'success',
      );
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : 'Failed to reconcile delivery',
        'error',
      );
    } finally {
      setIsWorking(false);
    }
  };

  const campaignAction = async (
    campaignId: string,
    action: 'activate' | 'process' | 'cancel',
  ) => {
    setIsWorking(true);
    try {
      const data = await callJson(
        `/api/admin/mass-email/${campaignId}/${action}`,
        {},
      );
      if (data.campaign) {
        rememberCampaignDetail(data.campaign as MassEmailCampaign);
      } else {
        await fetchCampaignDetail(campaignId);
      }
      showToast(`Campaign ${action} complete`, 'success');
      await refresh();
    } catch (error) {
      showToast(
        error instanceof Error ? error.message : `Campaign ${action} failed`,
        'error',
      );
    } finally {
      setIsWorking(false);
    }
  };
  return { reconcileRecipient, campaignAction };
}
