import { useCallback } from 'react';
import { fetchWithCsrf } from '@/lib/csrf';
import type { GroupOption, RecipientOption } from './MassEmailTypes';

interface MassEmailAudienceSearchProps {
  groupQuery: string;
  recipientQuery: string;
  targetUsernames: string[];
  setGroupResults: (groups: GroupOption[]) => void;
  setRecipientResults: (recipients: RecipientOption[]) => void;
  setIsSearchingGroups: (isSearching: boolean) => void;
  setIsSearchingRecipients: (isSearching: boolean) => void;
  setHasSearchedGroups: (hasSearched: boolean) => void;
  setHasSearchedRecipients: (hasSearched: boolean) => void;
  showToast: (message: string, variant: 'success' | 'error' | 'warning') => void;
}

export function useMassEmailAudienceSearch({ groupQuery, recipientQuery, targetUsernames, setGroupResults, setRecipientResults, setIsSearchingGroups, setIsSearchingRecipients, setHasSearchedGroups, setHasSearchedRecipients, showToast }: MassEmailAudienceSearchProps) {
  const searchGroups = useCallback(async () => {
    if (groupQuery.trim().length < 2) {
      showToast('Enter at least 2 characters to search groups', 'error');
      return;
    }
    setIsSearchingGroups(true);
    setHasSearchedGroups(true);
    try {
      const response = await fetchWithCsrf(`/api/admin/groups?q=${encodeURIComponent(groupQuery.trim())}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Group search failed');
      setGroupResults(data.groups || []);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Group search failed', 'error');
    } finally {
      setIsSearchingGroups(false);
    }
  }, [groupQuery, setGroupResults, setHasSearchedGroups, setIsSearchingGroups, showToast]);

  const searchRecipients = useCallback(async () => {
    const query = recipientQuery.trim();
    if (query.length < 2) {
      showToast('Enter at least 2 characters to search recipients', 'error');
      return;
    }
    setIsSearchingRecipients(true);
    setHasSearchedRecipients(true);
    try {
      const response = await fetchWithCsrf(`/api/admin/users?q=${encodeURIComponent(query)}&limit=12`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Recipient search failed');
      const queryLower = query.toLowerCase();
      const users = ((data.users || []) as RecipientOption[])
        .filter((user) => [user.username, user.displayName || '', user.email || ''].some((value) => value.toLowerCase().includes(queryLower)))
        .slice(0, 12);
      setRecipientResults(users);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Recipient search failed', 'error');
    } finally {
      setIsSearchingRecipients(false);
    }
  }, [recipientQuery, setHasSearchedRecipients, setIsSearchingRecipients, setRecipientResults, showToast]);

  const recipientIsSelected = useCallback((recipient: RecipientOption) => {
    const username = recipient.username.trim();
    return targetUsernames.some((selectedUsername) => selectedUsername.trim().toLowerCase() === username.toLowerCase());
  }, [targetUsernames]);

  return { searchGroups, searchRecipients, recipientIsSelected };
}
