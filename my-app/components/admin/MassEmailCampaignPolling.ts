import { useCallback, useEffect } from 'react';
import { fetchWithCsrf } from '@/lib/csrf';
import { usePolling } from '@/hooks/usePolling';
import type { MassEmailCampaign } from './MassEmailTypes';

interface CampaignsResponse {
  campaigns: MassEmailCampaign[];
  selectedCampaign: MassEmailCampaign | null;
}

type CampaignAction =
  | { type: 'campaignSelected'; campaignId: string }
  | { type: 'campaignDetailLoading'; campaignId: string }
  | { type: 'campaignDetailLoaded'; campaign: MassEmailCampaign }
  | { type: 'campaignDetailFinished'; campaignId: string }
  | { type: 'pollCampaignSynced'; campaign: MassEmailCampaign };

interface MassEmailCampaignPollingProps {
  selectedCampaignId: string | null;
  campaignDetailsById: Record<string, MassEmailCampaign>;
  loadingCampaignId: string | null;
  dispatch: (action: CampaignAction) => void;
}

export function useMassEmailCampaignPolling({ selectedCampaignId, campaignDetailsById, loadingCampaignId, dispatch }: MassEmailCampaignPollingProps) {
  const fetchCampaigns = useCallback(async () => {
    const selectedQuery = selectedCampaignId ? `?id=${encodeURIComponent(selectedCampaignId)}` : '';
    const response = await fetchWithCsrf(`/api/admin/mass-email${selectedQuery}`);
    if (!response.ok) throw new Error('Failed to load mass email campaigns');
    return await response.json() as CampaignsResponse;
  }, [selectedCampaignId]);

  const { data: campaignsData, isLoading, refresh, lastUpdated } = usePolling(fetchCampaigns, {
    interval: 15000,
    onError: (error) => console.error('Mass email polling failed:', error),
  });

  useEffect(() => {
    if (campaignsData?.selectedCampaign) dispatch({ type: 'pollCampaignSynced', campaign: campaignsData.selectedCampaign });
  }, [campaignsData?.selectedCampaign, dispatch]);

  const fetchCampaignDetail = useCallback(async (campaignId: string) => {
    dispatch({ type: 'campaignDetailLoading', campaignId });
    try {
      const response = await fetchWithCsrf(`/api/admin/mass-email/${encodeURIComponent(campaignId)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Failed to load campaign details');
      dispatch({ type: 'campaignDetailLoaded', campaign: data.campaign as MassEmailCampaign });
    } catch (error) {
      console.error('Failed to load mass email campaign details:', error);
    } finally {
      dispatch({ type: 'campaignDetailFinished', campaignId });
    }
  }, [dispatch]);

  const effectiveSelectedCampaignId = selectedCampaignId || campaignsData?.selectedCampaign?.id || campaignsData?.campaigns[0]?.id || null;
  useEffect(() => {
    if (!effectiveSelectedCampaignId || campaignDetailsById[effectiveSelectedCampaignId] || loadingCampaignId === effectiveSelectedCampaignId) return;
    void fetchCampaignDetail(effectiveSelectedCampaignId);
  }, [campaignDetailsById, effectiveSelectedCampaignId, fetchCampaignDetail, loadingCampaignId]);

  const selectCampaign = useCallback((campaignId: string) => {
    dispatch({ type: 'campaignSelected', campaignId });
    if (!campaignDetailsById[campaignId]) void fetchCampaignDetail(campaignId);
  }, [campaignDetailsById, dispatch, fetchCampaignDetail]);

  return { campaignsData, isLoading, refresh, lastUpdated, fetchCampaignDetail, selectCampaign, effectiveSelectedCampaignId };
}
