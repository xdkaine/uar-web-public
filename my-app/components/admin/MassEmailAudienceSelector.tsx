import type { Dispatch, KeyboardEvent, SetStateAction } from 'react';
import { Search, Users, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TokenInput } from '@/components/ui/TokenInput';
import type { GroupOption, RecipientOption } from './MassEmailTypes';

interface MassEmailAudienceSelectorProps {
  audienceSummary: string;
  includeAllDomainUsers: boolean;
  recipientQuery: string;
  recipientResults: RecipientOption[];
  selectedRecipients: RecipientOption[];
  manualUsernames: string[];
  groupQuery: string;
  groupResults: GroupOption[];
  selectedGroups: GroupOption[];
  recipientSearch: { isSearching: boolean; hasSearched: boolean };
  groupSearch: { isSearching: boolean; hasSearched: boolean };
  onIncludeAllDomainUsersChange: (value: boolean) => void;
  onRecipientQueryChange: (value: string) => void;
  onGroupQueryChange: (value: string) => void;
  onManualUsernamesChange: Dispatch<SetStateAction<string[]>>;
  onSearchRecipients: () => void;
  onSearchGroups: () => void;
  onAddRecipient: (recipient: RecipientOption) => void;
  onRemoveRecipient: (username: string) => void;
  onAddGroup: (group: GroupOption) => void;
  onRemoveGroup: (dn: string) => void;
}

function searchOnEnter(event: KeyboardEvent<HTMLInputElement>, onSearch: () => void) {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  onSearch();
}

export function MassEmailAudienceSelector({
  audienceSummary,
  includeAllDomainUsers,
  recipientQuery,
  recipientResults,
  selectedRecipients,
  manualUsernames,
  groupQuery,
  groupResults,
  selectedGroups,
  recipientSearch,
  groupSearch,
  onIncludeAllDomainUsersChange,
  onRecipientQueryChange,
  onGroupQueryChange,
  onManualUsernamesChange,
  onSearchRecipients,
  onSearchGroups,
  onAddRecipient,
  onRemoveRecipient,
  onAddGroup,
  onRemoveGroup,
}: MassEmailAudienceSelectorProps) {
  return (
    <section className="rounded-lg border bg-muted/50 p-4">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h3 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Users className="h-4 w-4" /> Audience</h3><p className="text-xs text-muted-foreground">{audienceSummary}</p></div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" checked={includeAllDomainUsers} onChange={(event) => onIncludeAllDomainUsersChange(event.target.checked)} className="h-4 w-4 rounded border-border" />All configured AD users</label>
      </div>
      <Tabs defaultValue="recipients" className="space-y-4">
        <TabsList><TabsTrigger value="recipients">Recipients</TabsTrigger><TabsTrigger value="groups">Groups</TabsTrigger></TabsList>
        <TabsContent value="recipients" className="space-y-4">
          <div className="flex gap-2">
            <input value={recipientQuery} onChange={(event) => onRecipientQueryChange(event.target.value)} onKeyDown={(event) => searchOnEnter(event, onSearchRecipients)} className="min-w-0 flex-1 rounded-md border bg-card px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500" aria-label="Search recipients" placeholder="Search username, name, or email" />
            <Button type="button" variant="outline" onClick={onSearchRecipients} disabled={recipientSearch.isSearching} aria-label="Search recipients"><Search className="h-4 w-4" /></Button>
          </div>
          <div className="max-h-44 space-y-2 overflow-y-auto">
            {recipientSearch.isSearching && <p className="rounded-md border border-dashed bg-card px-3 py-4 text-center text-sm text-muted-foreground">Searching recipients...</p>}
            {recipientResults.map((recipient) => <button key={recipient.dn || recipient.username} type="button" onClick={() => onAddRecipient(recipient)} className="block w-full rounded-md border bg-card px-3 py-2 text-left text-sm hover:bg-muted/50"><span className="font-medium text-foreground">{recipient.displayName || recipient.username}</span><span className="block truncate text-xs text-muted-foreground">{recipient.username}{recipient.email ? ` · ${recipient.email}` : ''}</span></button>)}
            {!recipientSearch.isSearching && recipientSearch.hasSearched && recipientResults.length === 0 && <p className="rounded-md border border-dashed bg-card px-3 py-4 text-center text-sm text-muted-foreground">No recipients found.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedRecipients.map((recipient) => <span key={recipient.username} className="inline-flex items-center gap-1 rounded-full bg-blue-50 dark:bg-blue-950/40 px-2 py-1 text-xs font-medium text-blue-800">{recipient.displayName || recipient.username}<button type="button" onClick={() => onRemoveRecipient(recipient.username)} aria-label={`Remove ${recipient.username}`}><XCircle className="h-3 w-3" /></button></span>)}
          </div>
          <div className="space-y-2">
            <label className="block text-xs font-medium uppercase tracking-wide text-muted-foreground" htmlFor="mass-email-usernames">Manual recipients</label>
            <TokenInput id="mass-email-usernames" values={manualUsernames} onChange={onManualUsernamesChange} placeholder="Type a username or email, then press Enter" ariaLabel="Manual recipients" />
            <p className="text-xs text-muted-foreground">Enter, comma, semicolon, or paste a list to create individual recipients. Backspace removes the last item.</p>
          </div>
        </TabsContent>
        <TabsContent value="groups" className="space-y-4">
          <div className="flex gap-2">
            <input value={groupQuery} onChange={(event) => onGroupQueryChange(event.target.value)} onKeyDown={(event) => searchOnEnter(event, onSearchGroups)} className="min-w-0 flex-1 rounded-md border bg-card px-3 py-2 text-sm focus:outline-hidden focus:ring-2 focus:ring-blue-500" aria-label="Search AD groups" placeholder="Search AD groups" />
            <Button type="button" variant="outline" onClick={onSearchGroups} disabled={groupSearch.isSearching} aria-label="Search groups"><Search className="h-4 w-4" /></Button>
          </div>
          <div className="max-h-44 space-y-2 overflow-y-auto">
            {groupSearch.isSearching && <p className="rounded-md border border-dashed bg-card px-3 py-4 text-center text-sm text-muted-foreground">Searching groups...</p>}
            {groupResults.map((group) => <button key={group.dn} type="button" onClick={() => onAddGroup(group)} className="block w-full rounded-md border bg-card px-3 py-2 text-left text-sm hover:bg-muted/50"><span className="font-medium text-foreground">{group.name}</span><span className="block truncate text-xs text-muted-foreground">{group.description || group.dn}</span></button>)}
            {!groupSearch.isSearching && groupSearch.hasSearched && groupResults.length === 0 && <p className="rounded-md border border-dashed bg-card px-3 py-4 text-center text-sm text-muted-foreground">No groups found.</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {selectedGroups.map((group) => <span key={group.dn} className="inline-flex items-center gap-1 rounded-full bg-blue-50 dark:bg-blue-950/40 px-2 py-1 text-xs font-medium text-blue-800">{group.name}<button type="button" onClick={() => onRemoveGroup(group.dn)} aria-label={`Remove ${group.name}`}><XCircle className="h-3 w-3" /></button></span>)}
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}
