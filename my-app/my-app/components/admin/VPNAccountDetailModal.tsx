'use client';

import { useState, useEffect, useCallback } from 'react';
import type { ReactNode } from 'react';
import { useToast } from '@/hooks/useToast';
import { fetchWithCsrf } from '@/lib/csrf';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info, User, Clock, Shield, AlertTriangle, MessageSquare, History } from 'lucide-react';

interface VPNAccountDetail {
  id: string;
  username: string;
  name: string;
  email: string;
  portalType: string;
  isInternal: boolean;
  status: string;
  expiresAt?: string;
  password: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  createdByFaculty: boolean;
  facultyCreatedAt?: string;
  disabledAt?: string;
  disabledBy?: string;
  disabledReason?: string;
  revokedAt?: string;
  revokedBy?: string;
  revokedReason?: string;
  restoredAt?: string;
  restoredBy?: string;
  canRestore: boolean;
  notes?: string;
  batchId?: string;
  accessRequestId?: string;
  importId?: string;
  adUsername?: string;
  statusLogs?: Array<{
    id: string;
    createdAt: string;
    oldStatus?: string;
    newStatus: string;
    changedBy: string;
    reason?: string;
  }>;
}

interface Comment {
  id: string;
  createdAt: string;
  updatedAt: string;
  comment: string;
  author: string;
  type?: string;
}

interface VPNAccountDetailModalProps {
  accountId: string;
  onClose: () => void;
  onRefresh?: () => void;
}

export default function VPNAccountDetailModal({ accountId, onClose }: VPNAccountDetailModalProps) {
  const { showToast } = useToast();
  const [account, setAccount] = useState<VPNAccountDetail | null>(null);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingComments, setLoadingComments] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  const fetchAccountDetails = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`/api/admin/vpn-accounts/${accountId}`);
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to fetch account details');
      }

      const data = await res.json();
      setAccount(data.account || data);
    } catch (error) {
      console.error('Error fetching account details:', error);
      showToast(error instanceof Error ? error.message : 'Failed to load account details', 'error');
    } finally {
      setLoading(false);
    }
  }, [accountId, showToast]);

  const fetchComments = useCallback(async () => {
    try {
      setLoadingComments(true);
      const res = await fetchWithCsrf(`/api/admin/vpn-accounts/${accountId}/comments`);
      
      if (!res.ok) {
        throw new Error('Failed to fetch comments');
      }

      const data = await res.json();
      setComments(data.comments || []);
    } catch (error) {
      console.error('Error fetching comments:', error);
      // Don't show error toast for comments - non-critical
    } finally {
      setLoadingComments(false);
    }
  }, [accountId]);

  useEffect(() => {
    fetchAccountDetails();
    fetchComments();
  }, [fetchAccountDetails, fetchComments]);

  const handleAddComment = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!newComment.trim()) {
      showToast('Please enter a comment', 'error');
      return;
    }

    try {
      setSubmittingComment(true);
      const res = await fetchWithCsrf(`/api/admin/vpn-accounts/${accountId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ comment: newComment }),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to add comment');
      }

      showToast('Comment added successfully', 'success');
      setNewComment('');
      await fetchComments();
    } catch (error) {
      console.error('Error adding comment:', error);
      showToast(error instanceof Error ? error.message : 'Failed to add comment', 'error');
    } finally {
      setSubmittingComment(false);
    }
  };

  const getStatusBadge = (status: string) => {
     switch(status) {
       case 'active': return <Badge className="bg-green-100 text-green-800 border-green-200">Active</Badge>;
       case 'pending_faculty': return <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Pending Faculty</Badge>;
       case 'disabled': return <Badge variant="destructive" className="bg-red-100 text-red-800 border-red-200">Disabled</Badge>;
       case 'revoked': return <Badge variant="destructive" className="bg-purple-100 text-purple-800 border-purple-200">Revoked</Badge>;
       default: return <Badge variant="outline">{status}</Badge>;
     }
  };

  const getPortalBadge = (portalType: string) => {
    switch(portalType) {
      case 'Management': return <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-200">Management</Badge>;
      case 'Limited': return <Badge variant="outline" className="bg-purple-100 text-purple-800 border-purple-200">Limited</Badge>;
      case 'External': return <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-200">External</Badge>;
      default: return <Badge variant="outline">{portalType}</Badge>;
    }
  };

  const formatDate = (date?: string) => {
    if (!date) return 'N/A';
    return new Date(date).toLocaleString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const InfoRow = ({ label, value, highlight = false, icon = null }: { label: string; value?: ReactNode; highlight?: boolean; icon?: ReactNode }) => (
    <div className="flex py-3 border-b last:border-b-0 items-center">
      <dt className="w-1/3 text-sm font-medium text-muted-foreground flex items-center gap-2">
        {icon}
        {label}
      </dt>
      <dd className={`w-2/3 text-sm ${highlight ? 'font-semibold text-foreground' : 'text-foreground'} break-all`}>
        {value || 'N/A'}
      </dd>
    </div>
  );

  if (loading) {
    return (
      <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
           <div className="flex justify-center items-center py-12">
             <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
           </div>
        </DialogContent>
      </Dialog>
    );
  }

  if (!account) {
    return (
      <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
         <DialogContent>
           <div className="text-center py-8">
             <p className="text-muted-foreground">VPN account not found</p>
             <Button onClick={onClose} className="mt-4">Close</Button>
           </div>
         </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>VPN Account Details</DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <Card className="bg-blue-50/50 border-blue-100">
            <CardContent className="p-6">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-1">{account.name}</h3>
                  <div className="flex items-center gap-2 text-gray-600 mb-2">
                    <User className="w-4 h-4" />
                    <span className="font-mono text-sm">{account.username}</span>
                  </div>
                  <div className="flex items-center gap-2 text-gray-600">
                     <span className="text-sm">{account.email}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2 items-end">
                   {getStatusBadge(account.status)}
                   {getPortalBadge(account.portalType)}
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 mt-6 pt-4 border-t border-blue-200/50">
                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Type</span>
                  <div className="mt-1 flex items-center gap-2 font-medium">
                    {account.isInternal ? (
                       <Badge variant="secondary" className="bg-blue-100/50 text-blue-800 hover:bg-blue-100">Internal</Badge>
                    ) : ( 
                       <Badge variant="secondary" className="bg-purple-100/50 text-purple-800 hover:bg-purple-100">External</Badge>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Account ID</span>
                  <p className="text-sm font-mono text-muted-foreground break-all mt-1">{account.id}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="overview">Overview</TabsTrigger>
              <TabsTrigger value="timeline">Timeline</TabsTrigger>
              <TabsTrigger value="comments">Comments ({comments.length})</TabsTrigger>
            </TabsList>
            
            <div className="mt-4 max-h-[50vh] overflow-y-auto pr-1">
              <TabsContent value="overview" className="space-y-6">
                <Card>
                  <CardHeader className="py-3 bg-gray-50/50 border-b">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Info className="w-4 h-4 text-primary" />
                      Basic Information
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="px-6 py-2">
                      <dl>
                        <InfoRow label="Username" value={account.username} highlight />
                        <InfoRow label="Name" value={account.name} highlight />
                        <InfoRow label="Email" value={account.email} highlight />
                        <InfoRow label="Portal Type" value={account.portalType} />
                        <InfoRow label="Account Type" value={account.isInternal ? 'Internal' : 'External'} />
                        <InfoRow label="Status" value={account.status.replace(/_/g, ' ')} />
                        {account.expiresAt && <InfoRow label="Expires At" value={formatDate(account.expiresAt)} icon={<Clock className="w-4 h-4 text-muted-foreground" />} />}
                        {account.adUsername && <InfoRow label="Linked AD Account" value={account.adUsername} />}
                      </dl>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="py-3 bg-gray-50/50 border-b">
                    <CardTitle className="text-base flex items-center gap-2">
                      <History className="w-4 h-4 text-primary" />
                      Creation Details
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                     <div className="px-6 py-2">
                      <dl>
                        <InfoRow label="Created By" value={account.createdBy} />
                        <InfoRow label="Created At" value={formatDate(account.createdAt)} />
                        <InfoRow label="Faculty Approved" value={account.createdByFaculty ? '✓ Yes' : '✗ No'} />
                        {account.facultyCreatedAt && <InfoRow label="Faculty Approved At" value={formatDate(account.facultyCreatedAt)} />}
                        {account.accessRequestId && <InfoRow label="Access Request ID" value={<span className="font-mono text-xs break-all">{account.accessRequestId}</span>} />}
                        {account.importId && <InfoRow label="Import ID" value={<span className="font-mono text-xs break-all">{account.importId}</span>} />}
                        {account.batchId && <InfoRow label="Batch ID" value={<span className="font-mono text-xs break-all">{account.batchId}</span>} />}
                      </dl>
                    </div>
                  </CardContent>
                </Card>

                {(account.disabledAt || account.revokedAt || account.restoredAt) && (
                  <Card>
                    <CardHeader className="py-3 bg-gray-50/50 border-b">
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
                )}

                {account.notes && (
                  <Card>
                    <CardHeader className="py-3 bg-gray-50/50 border-b">
                      <CardTitle className="text-base">Notes</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4">
                      <p className="text-sm text-gray-700 whitespace-pre-wrap">{account.notes}</p>
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader className="py-3 bg-gray-50/50 border-b">
                     <CardTitle className="text-base flex items-center gap-2">
                       <Shield className="w-4 h-4 text-primary" />
                       System Information
                     </CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                     <div className="px-6 py-2">
                        <dl>
                           <InfoRow label="Account ID" value={<span className="font-mono text-xs break-all">{account.id}</span>} />
                           <InfoRow label="Created At" value={formatDate(account.createdAt)} />
                           <InfoRow label="Updated At" value={formatDate(account.updatedAt)} />
                        </dl>
                     </div>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="timeline">
                <div className="space-y-4">
                  {loadingComments ? (
                    <div className="flex justify-center items-center py-8">
                       <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                    </div>
                  ) : account.statusLogs && account.statusLogs.length > 0 ? (
                    <div className="space-y-4 pl-2">
                      {account.statusLogs.map((log) => (
                        <div key={log.id} className="relative pl-6 pb-6 border-l-2 border-gray-200 last:pb-0 last:border-l-0">
                          <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full bg-primary border-4 border-white"></div>
                          <div className="bg-white border rounded-lg p-4 shadow-sm">
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

              <TabsContent value="comments" className="space-y-6">
                 <Card>
                    <CardHeader>
                       <CardTitle className="text-base flex items-center gap-2">
                          <MessageSquare className="w-4 h-4" />
                          Add Comment
                       </CardTitle>
                    </CardHeader>
                    <CardContent>
                       <form onSubmit={handleAddComment}>
                          <Textarea
                              value={newComment}
                              onChange={(e) => setNewComment(e.target.value)}
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
                                <p className="text-sm text-gray-700 whitespace-pre-wrap">{comment.comment}</p>
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
            </div>
          </Tabs>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
