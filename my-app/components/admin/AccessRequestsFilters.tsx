'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Download, Search } from 'lucide-react';
import type { AccessRequestsDisplayModel, ReviewStageBucket, StatusFilter, TypeFilter, VerificationFilter } from './AccessRequestsTypes';
import { AccessRequestsActiveFilters } from './AccessRequestsActiveFilters';

export function AccessRequestsFilters({ model }: { model: AccessRequestsDisplayModel }) {
  const { summary, collectionTotal, searchQuery, statusFilter, reviewStageFilter, typeFilter, verificationFilter, eventFilter, setSearchQuery, setStatusFilter, setReviewStageFilter, setTypeFilter, setVerificationFilter, setEventFilter, setShowAdvancedFilters, showAdvancedFilters, exportToCSV, availableEvents, reviewStageBuckets, dispatch } = model;
  return <>
<div className="bg-card rounded-lg shadow-lg border-2 border-border p-6 mb-4">
  <div className="flex flex-wrap gap-6 text-sm mb-6">
<div>
  <span className="font-semibold text-muted-foreground">Total:</span>
  <span className="ml-2 text-foreground font-bold">{summary.total ?? collectionTotal}</span>
</div>
<div>
  <span className="font-semibold text-muted-foreground">Filtered:</span>
  <span className="ml-2 text-blue-600 dark:text-blue-400 font-bold">{collectionTotal}</span>
</div>
<div>
  <span className="font-semibold text-muted-foreground">Internal:</span>
  <span className="ml-2 text-blue-600 dark:text-blue-400 font-bold">{summary.internal ?? 0}</span>
</div>
<div>
  <span className="font-semibold text-muted-foreground">External:</span>
  <span className="ml-2 text-purple-600 dark:text-purple-400 font-bold">{summary.external ?? 0}</span>
</div>
<div>
  <span className="font-semibold text-muted-foreground">Verified:</span>
  <span className="ml-2 text-green-600 dark:text-green-400 font-bold">{summary.verified ?? 0}</span>
</div>
  </div>

  <div className="flex flex-col gap-3 mb-4 sm:flex-row">
<div className="flex-1">
  <div className="relative">
    <label htmlFor="access-request-search" className="sr-only">Search requests</label>
    <Input
      id="access-request-search"
      type="text"
      placeholder="Search by name, email, institution, or event..."
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      className="pl-10"
    />
    <Search className="absolute left-3 top-2.5 h-5 w-5 text-muted-foreground" />
  </div>
</div>
<Button
  onClick={exportToCSV}
  className="bg-blue-600 hover:bg-blue-700 text-white gap-2"
>
  <Download className="w-4 h-4" />
  Export
</Button>
<Button
  variant={showAdvancedFilters ? "default" : "secondary"}
  onClick={setShowAdvancedFilters}
  className={showAdvancedFilters ? "" : "bg-muted hover:bg-border text-muted-foreground"}
>
  {showAdvancedFilters ? 'Hide Filters' : 'Advanced Filters'}
</Button>
{(searchQuery || statusFilter !== 'all' || reviewStageFilter !== 'all' || typeFilter !== 'all' || verificationFilter !== 'all' || eventFilter) && (
  <Button
    variant="ghost"
    onClick={() => {
      dispatch({ type: 'clear' });
    }}
    className="bg-red-100 dark:bg-red-950/60 text-red-700 dark:text-red-200 hover:bg-red-200 dark:hover:bg-red-900/60 hover:text-red-800 dark:hover:text-red-200"
  >
    Clear All
  </Button>
)}
  </div>

  {showAdvancedFilters && (
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 pt-4 border-t border-border">
  <div>
    <span id="access-request-status-label" className="block text-sm font-semibold text-muted-foreground mb-2">
      Request Status
    </span>
    <Select value={statusFilter} onValueChange={(val) => setStatusFilter(val as StatusFilter)}>
      <SelectTrigger aria-labelledby="access-request-status-label">
        <SelectValue placeholder="All Status" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Status</SelectItem>
        <SelectItem value="pending_verification">Pending Verification</SelectItem>
        <SelectItem value="approved">Approved</SelectItem>
        <SelectItem value="rejected">Rejected</SelectItem>
        <SelectItem value="offboarded">Offboarded</SelectItem>
      </SelectContent>
    </Select>
  </div>

  <div>
    <span id="access-request-review-stage-label" className="block text-sm font-semibold text-muted-foreground mb-2">Configured review stage</span>
    <Select value={reviewStageFilter} onValueChange={(value) => setReviewStageFilter(value)}>
      <SelectTrigger aria-labelledby="access-request-review-stage-label"><SelectValue placeholder="All review stages" /></SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All review stages</SelectItem>
                  {reviewStageBuckets.map((bucket: ReviewStageBucket) => (
          <SelectItem key={`${bucket.workflowVersionId}:${bucket.stageKey}`} value={`${bucket.workflowVersionId}::${bucket.stageKey}`}>
            {bucket.label} — {bucket.workflowSource === 'pinned' ? `v${bucket.workflowVersion}` : 'legacy'}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>

  <div>
    <span id="access-request-type-label" className="block text-sm font-semibold text-muted-foreground mb-2">
      Request Type
    </span>
    <Select value={typeFilter} onValueChange={(val) => setTypeFilter(val as TypeFilter)}>
      <SelectTrigger aria-labelledby="access-request-type-label">
        <SelectValue placeholder="All Types" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All Types</SelectItem>
        <SelectItem value="internal">Internal Only</SelectItem>
        <SelectItem value="external">External Only</SelectItem>
      </SelectContent>
    </Select>
  </div>

  <div>
    <span id="access-request-verification-label" className="block text-sm font-semibold text-muted-foreground mb-2">
      Email Verification
    </span>
    <Select value={verificationFilter} onValueChange={(val) => setVerificationFilter(val as VerificationFilter)}>
      <SelectTrigger aria-labelledby="access-request-verification-label">
        <SelectValue placeholder="All" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all">All</SelectItem>
        <SelectItem value="verified">Verified Only</SelectItem>
        <SelectItem value="unverified">Unverified Only</SelectItem>
      </SelectContent>
    </Select>
  </div>

  <div>
    <span id="access-request-event-label" className="block text-sm font-semibold text-muted-foreground mb-2">
      Event
    </span>
    <Select value={eventFilter} onValueChange={(val) => setEventFilter(val)}>
      <SelectTrigger aria-labelledby="access-request-event-label">
        <SelectValue placeholder="All Events" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all_events" onClick={() => setEventFilter('')}>All Events</SelectItem>
        {availableEvents.map((event: string) => (
          <SelectItem key={event} value={event}>{event}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  </div>
</div>
  )}

  <AccessRequestsActiveFilters model={model} />

</div>


  </>;
}
