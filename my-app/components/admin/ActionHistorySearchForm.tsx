import type { FormEvent } from 'react';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';

interface ActionHistorySearchFormProps {
  lookup: string;
  eventKind: string;
  outcome: string;
  includeReads: boolean;
  canSearch: boolean;
  hasLookup: boolean;
  isLoading: boolean;
  eventKindOptions: string[];
  outcomeOptions: string[];
  onLookupChange: (value: string) => void;
  onEventKindChange: (value: string) => void;
  onOutcomeChange: (value: string) => void;
  onIncludeReadsChange: (value: boolean) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRefresh: () => void;
}

export function ActionHistorySearchForm({
  lookup,
  eventKind,
  outcome,
  includeReads,
  canSearch,
  hasLookup,
  isLoading,
  eventKindOptions,
  outcomeOptions,
  onLookupChange,
  onEventKindChange,
  onOutcomeChange,
  onIncludeReadsChange,
  onSubmit,
  onRefresh,
}: ActionHistorySearchFormProps) {
  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-border bg-muted/50 p-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(260px,1fr)_180px_180px_auto] lg:items-end">
        <div className="space-y-2">
          <Label htmlFor="action-history-lookup">Lookup</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="action-history-lookup"
              value={lookup}
              onChange={(event) => onLookupChange(event.target.value)}
              className="pl-9"
              placeholder="Name, username, email, request ID, or VPN ID"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Event</Label>
          <Select value={eventKind} onValueChange={onEventKindChange}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {eventKindOptions.map((option) => <SelectItem key={option} value={option} className="capitalize">{option}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Outcome</Label>
          <Select value={outcome} onValueChange={onOutcomeChange}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {outcomeOptions.map((option) => <SelectItem key={option} value={option} className="capitalize">{option}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Switch checked={includeReads} onCheckedChange={onIncludeReadsChange} id="monitor-include-read-events" />
            <Label htmlFor="monitor-include-read-events" className="text-sm">Reads</Label>
          </div>
          <Button type="submit" disabled={!canSearch || isLoading}>
            {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Search
          </Button>
          <Button type="button" variant="outline" disabled={!hasLookup || isLoading} onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>
      </div>
    </form>
  );
}
