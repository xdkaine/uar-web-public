'use client';

import type { FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TabsContent } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { MessageSquare, AlertTriangle } from 'lucide-react';
import { InfoRow } from './VPNAccountInfoRow';
import { formatDate, type VPNAccountDetail, type VPNAccountComment } from './vpnAccountDetails';

export function VPNAccountStatusHistory({ account }: { account: VPNAccountDetail }) {
  return (
    (account.disabledAt || account.revokedAt || account.restoredAt) && (
      <Card>
        <CardHeader className="py-3 bg-muted/50 border-b">
          <CardTitle className="text-base flex items-center gap-2 text-destructive">
            <AlertTriangle className="w-4 h-4" />
            Status History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="px-6 py-2">
            <dl>
              {account.disabledAt && (
                <>
                  <InfoRow label="Disabled At" value={formatDate(account.disabledAt)} />
                  <InfoRow label="Disabled By" value={account.disabledBy} />
                  {account.disabledReason && <InfoRow label="Disable Reason" value={account.disabledReason} />}
                </>
              )}
              {account.revokedAt && (
                <>
                  <InfoRow label="Revoked At" value={formatDate(account.revokedAt)} />
                  <InfoRow label="Revoked By" value={account.revokedBy} />
                  {account.revokedReason && <InfoRow label="Revoke Reason" value={account.revokedReason} />}
                  <InfoRow label="Can Restore" value={account.canRestore ? '✓ Yes' : '✗ No'} />
                </>
              )}
              {account.restoredAt && (
                <>
                  <InfoRow label="Restored At" value={formatDate(account.restoredAt)} />
                  <InfoRow label="Restored By" value={account.restoredBy} />
                </>
              )}
            </dl>
          </div>
        </CardContent>
      </Card>
    )
  );
}

export function VPNAccountTimeline({ account, loadingComments }: { account: VPNAccountDetail; loadingComments: boolean }) {
  return (
    <TabsContent value="timeline">
      <div className="space-y-4">
        {loadingComments ? (
          <div className="flex justify-center items-center py-8">
             <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
          </div>
        ) : account.statusLogs && account.statusLogs.length > 0 ? (
          <div className="space-y-4 pl-2">
            {account.statusLogs.map((log) => (
              <div key={log.id} className="relative pl-6 pb-6 border-l-2 border-border last:pb-0 last:border-l-0">
                <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-primary border-4 border-white"></div>
                <div className="bg-card border rounded-lg p-4 shadow-sm">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-medium text-sm">
                          Status changed from <span className="text-muted-foreground">{log.oldStatus || 'none'}</span> to{' '}
                          <span className="font-bold text-primary">{log.newStatus}</span>
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Changed by <span className="font-medium text-foreground">{log.changedBy}</span>
                        </p>
                        {log.reason && (
                          <div className="mt-2 text-sm bg-muted/50 p-2 rounded border text-muted-foreground">
                            {log.reason}
                          </div>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground whitespace-nowrap ml-4">
                        {formatDate(log.createdAt)}
                      </span>
                    </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground border-2 border-dashed rounded-lg">
            No status changes recorded
          </div>
        )}
      </div>
    </TabsContent>
  );
}

interface VPNAccountCommentsProps {
  comments: VPNAccountComment[];
  loadingComments: boolean;
  newComment: string;
  submittingComment: boolean;
  onCommentChange: (value: string) => void;
  onSubmit: (event: FormEvent) => void;
}

export function VPNAccountComments({ comments, loadingComments, newComment, submittingComment, onCommentChange, onSubmit }: VPNAccountCommentsProps) {
  return (
    <TabsContent value="comments" className="space-y-6">
       <Card>
          <CardHeader>
             <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="w-4 h-4" />
                Add Comment
             </CardTitle>
          </CardHeader>
          <CardContent>
             <form onSubmit={onSubmit}>
                <Textarea
                    value={newComment}
                    onChange={(e) => onCommentChange(e.target.value)}
                    placeholder="Enter your comment here..."
                    className="min-h-[100px] mb-4"
                    disabled={submittingComment}
                />
                <div className="flex justify-end">
                  <Button
                     type="submit"
                     disabled={submittingComment || !newComment.trim()}
                  >
                     {submittingComment ? 'Adding...' : 'Add Comment'}
                  </Button>
                </div>
             </form>
          </CardContent>
       </Card>

       <div className="space-y-4">
          <h4 className="font-semibold text-sm text-muted-foreground">Comments ({comments.length})</h4>
          {loadingComments ? (
             <div className="flex justify-center items-center py-8">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
             </div>
          ) : comments.length > 0 ? (
             comments.map((comment) => (
                <Card key={comment.id}>
                   <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                         <div className="flex items-center gap-2">
                            <span className="font-semibold text-sm">{comment.author}</span>
                            {comment.type && (
                               <Badge variant="secondary" className="text-xs font-normal">
                                  {comment.type}
                               </Badge>
                            )}
                         </div>
                         <span className="text-xs text-muted-foreground">{formatDate(comment.createdAt)}</span>
                      </div>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{comment.comment}</p>
                      {comment.createdAt !== comment.updatedAt && (
                         <p className="text-xs text-muted-foreground mt-2 italic">
                            Edited: {formatDate(comment.updatedAt)}
                         </p>
                      )}
                   </CardContent>
                </Card>
             ))
          ) : (
             <div className="text-center py-12 text-muted-foreground bg-muted/30 rounded-lg border-2 border-dashed">
                No comments yet. Be the first to add one!
             </div>
          )}
       </div>
    </TabsContent>
  );
}
