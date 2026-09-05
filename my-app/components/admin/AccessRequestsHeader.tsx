'use client';

import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { AccessRequestTime } from './AccessRequestsLocalizedTime';
import type { AccessRequestsDisplayModel, ReviewStageBucket } from './AccessRequestsTypes';

export function AccessRequestsHeader({ model }: { model: AccessRequestsDisplayModel }) {
  const { totalRequests, pendingVerification, approved, reviewStageBuckets, setReviewStageFilter, lastUpdated, isPolling, isPollingLoading, togglePolling, refresh } = model;
  return <>
<Alert className="mb-6 bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900 text-blue-900 dark:text-blue-200">
  <AlertCircle className="h-4 w-4 text-blue-500" />
  <div className="ml-2">
<p className="text-sm">
  <span className="font-semibold">Verification Email:</span> For requests with <span className="font-medium italic">&quot;Pending Verification&quot;</span> status and unverified emails,
  use the <span className="font-semibold">&quot;Actions&quot;</span> dropdown in the Actions column to view the request or resend the verification email.
</p>
  </div>
</Alert>

<div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
  <div className="bg-card p-4 sm:p-6 rounded-lg shadow-lg border-2 border-border">
<div className="text-muted-foreground text-xs sm:text-sm font-medium">Total Requests</div>
<div className="text-2xl sm:text-3xl font-bold text-foreground mt-2">{totalRequests}</div>
  </div>
  <div className="bg-card p-4 sm:p-6 rounded-lg shadow-lg border-2 border-border">
<div className="text-muted-foreground text-xs sm:text-sm font-medium">Pending Verification</div>
<div className="text-2xl sm:text-3xl font-bold text-muted-foreground mt-2">{pendingVerification}</div>
  </div>
  {reviewStageBuckets.map((bucket: ReviewStageBucket) => (
<button
  type="button"
  key={`${bucket.workflowVersionId}:${bucket.stageKey}`}
  onClick={() => setReviewStageFilter(`${bucket.workflowVersionId}::${bucket.stageKey}`)}
  className="bg-card p-4 text-left sm:p-6 rounded-lg shadow-lg border-2 border-border hover:border-primary"
>
  <div className="text-muted-foreground text-xs sm:text-sm font-medium">{bucket.label}</div>
  <div className="mt-1 text-[11px] text-muted-foreground">{bucket.workflowSource === 'pinned' ? `Workflow v${bucket.workflowVersion}` : 'Legacy default'}</div>
  <div className="text-2xl sm:text-3xl font-bold text-blue-500 mt-2">{bucket.count}</div>
</button>
  ))}
  <div className="bg-card p-4 sm:p-6 rounded-lg shadow-lg border-2 border-border">
<div className="text-muted-foreground text-xs sm:text-sm font-medium">Approved</div>
<div className="text-2xl sm:text-3xl font-bold text-green-600 dark:text-green-400 mt-2">{approved}</div>
  </div>
</div>

<div className="flex flex-col sm:flex-row justify-end items-start sm:items-center gap-4 mb-6">
  <div className="flex items-center gap-2 text-sm text-muted-foreground">
{lastUpdated && (
  <span>Updated: <AccessRequestTime value={lastUpdated} /></span>
)}
  </div>

  <div className="flex items-center gap-3">
<Button
  variant="outline"
  size="sm"
  onClick={togglePolling}
  className={`gap-2 ${isPolling ? 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-200 border-green-200 dark:border-green-900 hover:bg-green-100' : 'bg-muted/50 text-muted-foreground'}`}
>
  <div className={`w-2 h-2 rounded-full ${isPolling ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground'}`} />
  {isPolling ? 'Live Updates On' : 'Live Updates Off'}
</Button>

<Button
  variant="outline"
  size="sm"
  onClick={() => refresh()}
  disabled={isPollingLoading}
  className="gap-2"
>
  <RefreshCw className={`w-4 h-4 ${isPollingLoading ? 'animate-spin' : ''}`} />
  Refresh
</Button>
  </div>
</div>


  </>;
}
