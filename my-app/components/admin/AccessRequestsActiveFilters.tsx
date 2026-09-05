'use client';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import type { AccessRequestsDisplayModel, ReviewStageBucket } from './AccessRequestsTypes';
export function AccessRequestsActiveFilters({ model }: { model: AccessRequestsDisplayModel }) {
  const { statusFilter, reviewStageFilter, typeFilter, verificationFilter, eventFilter, reviewStageBuckets, setStatusFilter, setReviewStageFilter, setTypeFilter, setVerificationFilter, setEventFilter } = model;
  return <>
{(statusFilter !== 'all' || reviewStageFilter !== 'all' || typeFilter !== 'all' || verificationFilter !== 'all' || eventFilter) && (
<div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-border">
<span className="text-sm font-semibold text-muted-foreground">Active Filters:</span>
{statusFilter !== 'all' && (
  <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200 rounded-full text-sm">
    Status: {statusFilter.replace(/_/g, ' ')}
    <Button
      variant="ghost"
      size="icon"
      aria-label="Remove status filter"
      className="h-4 w-4 ml-1 p-0 hover:bg-transparent hover:text-blue-900"
      onClick={() => setStatusFilter('all')}
    >
      <X className="h-3 w-3" />
    </Button>
  </span>
)}
{reviewStageFilter !== 'all' && (
  <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200 rounded-full text-sm">
              Review stage: {reviewStageBuckets.find((bucket: ReviewStageBucket) => `${bucket.workflowVersionId}::${bucket.stageKey}` === reviewStageFilter)?.label || 'configured stage'}
    <Button variant="ghost" size="icon" aria-label="Remove review stage filter" className="h-4 w-4 ml-1 p-0" onClick={() => setReviewStageFilter('all')}><X className="h-3 w-3" /></Button>
  </span>
)}
{typeFilter !== 'all' && (
  <span className="inline-flex items-center gap-1 px-3 py-1 bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-200 rounded-full text-sm">
    Type: {typeFilter}
    <Button
      variant="ghost"
      size="icon"
      aria-label="Remove request type filter"
      className="h-4 w-4 ml-1 p-0 hover:bg-transparent hover:text-purple-900"
      onClick={() => setTypeFilter('all')}
    >
      <X className="h-3 w-3" />
    </Button>
  </span>
)}
{verificationFilter !== 'all' && (
  <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 dark:bg-green-950/60 text-green-800 dark:text-green-200 rounded-full text-sm">
    Verification: {verificationFilter}
    <Button
      variant="ghost"
      size="icon"
      aria-label="Remove verification filter"
      className="h-4 w-4 ml-1 p-0 hover:bg-transparent hover:text-green-900"
      onClick={() => setVerificationFilter('all')}
    >
      <X className="h-3 w-3" />
    </Button>
  </span>
)}
{eventFilter && (
  <span className="inline-flex items-center gap-1 px-3 py-1 bg-orange-100 dark:bg-orange-950/60 text-orange-800 dark:text-orange-200 rounded-full text-sm">
    Event: {eventFilter}
    <Button
      variant="ghost"
      size="icon"
      aria-label="Remove event filter"
      className="h-4 w-4 ml-1 p-0 hover:bg-transparent hover:text-orange-900"
      onClick={() => setEventFilter('')}
    >
      <X className="h-3 w-3" />
    </Button>
  </span>
)}
</div>
)}
  </>;
}
