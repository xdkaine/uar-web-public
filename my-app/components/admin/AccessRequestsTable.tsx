'use client';

import Link from 'next/link';
import Toast from '@/components/Toast';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { FileText, MoreHorizontal, RefreshCw, Send } from 'lucide-react';
import { AccessRequestDate, AccessRequestDateTime, AccessRequestExpiry } from './AccessRequestsLocalizedTime';
import type { AccessRequest, AccessRequestsDisplayModel } from './AccessRequestsTypes';

export function AccessRequestsTable({ model }: { model: AccessRequestsDisplayModel }) {
  const { sortedRequests, paginatedRequests, totalPages, pageSize, collectionTotal, currentPage, nextCursor, setPageSize, setCurrentPage, handleSort, sortField, sortDirection, getStatusBadge, resendingId, handleResendVerification, dispatch, toast, hideToast } = model;
  return <>
<Card className="overflow-hidden">
  {sortedRequests.length === 0 ? (
<div className="p-6 sm:p-8 text-center text-muted-foreground">
  No requests found matching your search
</div>
  ) : (
<>
<div className="space-y-3 p-3 md:hidden">
  {paginatedRequests.map((req: AccessRequest) => (
    <Card key={req.id}>
      <div className="space-y-2 p-4">
        <div className="flex items-start justify-between gap-3"><div><p className="font-medium">{req.name}</p><p className="text-sm text-muted-foreground">{req.email}</p></div>{getStatusBadge(req)}</div>
        <p className="text-xs text-muted-foreground">Submitted <AccessRequestDateTime value={req.createdAt} /> · {req.isInternal ? 'Internal' : 'External'} · {req.isVerified ? 'Verified' : 'Unverified'}</p>
        <Button asChild size="sm" variant="outline"><Link href={`/admin/requests/${req.id}`}>View request</Link></Button>
      </div>
    </Card>
  ))}
</div>
<div className="hidden rounded-md border md:block">
  <Table>
    <TableHeader>
      <TableRow>
        <TableHead
          className="cursor-pointer hover:bg-muted/50 select-none"
          onClick={() => handleSort('createdAt')}
        >
          <div className="flex items-center gap-2">
            Date
            {sortField === 'createdAt' && (
              <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
            )}
          </div>
        </TableHead>
        <TableHead
          className="cursor-pointer hover:bg-muted/50 select-none"
          onClick={() => handleSort('name')}
        >
          <div className="flex items-center gap-2">
            Name
            {sortField === 'name' && (
              <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
            )}
          </div>
        </TableHead>
        <TableHead
          className="cursor-pointer hover:bg-muted/50 select-none"
          onClick={() => handleSort('email')}
        >
          <div className="flex items-center gap-2">
            Email
            {sortField === 'email' && (
              <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
            )}
          </div>
        </TableHead>
        <TableHead>Type</TableHead>
        <TableHead>Event</TableHead>
        <TableHead>
          Access Ends
        </TableHead>
        <TableHead
          className="cursor-pointer hover:bg-muted/50 select-none"
          onClick={() => handleSort('status')}
        >
          <div className="flex items-center gap-2">
            Status
            {sortField === 'status' && (
              <span>{sortDirection === 'asc' ? '↑' : '↓'}</span>
            )}
          </div>
        </TableHead>
        <TableHead className="w-20 text-center">
          Verified
        </TableHead>
        <TableHead className="w-28 text-center">Actions</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
              {paginatedRequests.map((req: AccessRequest) => (
        <TableRow key={req.id} className="hover:bg-muted/50">
          <TableCell className="whitespace-nowrap">
            <AccessRequestDate value={req.createdAt} />
          </TableCell>
          <TableCell className="font-medium" title={req.name}>
            <div className="max-w-[180px] truncate">{req.name}</div>
          </TableCell>
          <TableCell className="text-muted-foreground" title={req.email}>
            <div className="max-w-[200px] truncate">{req.email}</div>
          </TableCell>
          <TableCell>
            <span className={`px-2 py-0.5 rounded-md text-xs font-semibold whitespace-nowrap ${
              req.isInternal ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-200' : 'bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-200'
            }`}>
              {req.isInternal ? 'Internal' : 'External'}
            </span>
          </TableCell>
          <TableCell className="text-muted-foreground">
            {req.event ? (
              <div className="max-w-[200px] truncate font-medium" title={req.event.name}>
                {req.event.name}
              </div>
            ) : req.eventReason ? (
              <div className="max-w-[200px] truncate text-muted-foreground italic" title={req.eventReason}>
                {req.eventReason}
              </div>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </TableCell>
          <TableCell className="whitespace-nowrap text-muted-foreground">
            {req.accountExpiresAt ? <AccessRequestExpiry value={req.accountExpiresAt} /> : (
              <span className="text-muted-foreground">—</span>
            )}
          </TableCell>
          <TableCell>
            <div className="inline-block" title={req.review?.workflow.warning || undefined}>{getStatusBadge(req)}</div>
          </TableCell>
          <TableCell className="text-center">
            {req.isVerified ? (
              <div className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-green-100 dark:bg-green-950/60" title="Verified">
                <span className="text-green-700 dark:text-green-200 font-bold text-sm">✓</span>
              </div>
            ) : (
              <div className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-muted" title="Not Verified">
                <span className="text-muted-foreground font-bold text-sm">✗</span>
              </div>
            )}
          </TableCell>
          <TableCell>
            <div className="flex justify-center">
              {!req.isVerified && ['pending_verification', 'verification_email_failed', 'verification_email_sending'].includes(req.status) ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Actions for ${req.name}`}
                      disabled={resendingId === req.id}
                      className="h-8 w-8 p-0"
                    >
                      {resendingId === req.id ? (
                        <RefreshCw className="h-4 w-4 animate-spin" />
                      ) : (
                        <MoreHorizontal className="h-4 w-4" />
                      )}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <Link href={`/admin/requests/${req.id}`} passHref>
                      <DropdownMenuItem>
                        <FileText className="mr-2 h-4 w-4" />
                        <span>View Request</span>
                      </DropdownMenuItem>
                    </Link>
                    <DropdownMenuItem
                      onClick={() => handleResendVerification(req.id)}
                      disabled={resendingId === req.id}
                    >
                      <Send className="mr-2 h-4 w-4" />
                      <span>Resend Email</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <Button asChild size="sm" variant="outline" className="h-8 text-xs">
                  <Link href={`/admin/requests/${req.id}`}>
                    View
                  </Link>
                </Button>
              )}
            </div>
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
</div>
</>
  )}

  {totalPages > 1 && (
<div className="px-6 py-4 border-t border-border flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
  <div className="flex flex-wrap items-center gap-2">
    <span id="access-request-page-size-label" className="text-sm text-muted-foreground">Show:</span>
    <Select
      value={pageSize.toString()}
      onValueChange={(val) => setPageSize(Number(val))}
    >
      <SelectTrigger aria-labelledby="access-request-page-size-label" className="w-20 h-8">
        <SelectValue placeholder={pageSize.toString()} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="10">10</SelectItem>
        <SelectItem value="25">25</SelectItem>
        <SelectItem value="50">50</SelectItem>
        <SelectItem value="100">100</SelectItem>
      </SelectContent>
    </Select>
    <span className="text-sm text-muted-foreground ml-4">
      Showing {collectionTotal ? (currentPage - 1) * pageSize + 1 : 0} to {Math.min(currentPage * pageSize, collectionTotal)} of {collectionTotal}
    </span>
  </div>

  <div className="flex items-center gap-2">
    <Button
      variant="outline"
      size="sm"
      onClick={() => setCurrentPage(1)}
      disabled={currentPage === 1}
      className="h-8 w-8 p-0"
    >
      <span className="sr-only">First page</span>
      <span aria-hidden="true">«</span>
    </Button>
    <Button
      variant="outline"
      size="sm"
      onClick={() => setCurrentPage(currentPage - 1)}
      disabled={currentPage === 1}
      className="h-8 w-8 p-0"
    >
      <span className="sr-only">Previous page</span>
      <span aria-hidden="true">‹</span>
    </Button>

    <span className="px-2 text-sm text-muted-foreground">Page {currentPage}</span>

    <Button
      variant="outline"
      size="sm"
      onClick={() => { if (nextCursor) dispatch({ type: 'next-page', cursor: nextCursor }); }}
      disabled={!nextCursor}
      className="h-8 w-8 p-0"
    >
      <span className="sr-only">Next page</span>
      <span aria-hidden="true">›</span>
    </Button>
  </div>
</div>
  )}
</Card>
<Toast
  message={toast.message}
  type={toast.type}
  isVisible={toast.isVisible}
  onClose={hideToast}
/>

  </>;
}
