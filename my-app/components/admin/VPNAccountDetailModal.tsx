'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatDate, type VPNAccountDetail, type VPNAccountComment } from './vpnAccountDetails';
import { InfoRow } from './VPNAccountInfoRow';
import { VPNAccountTimeline, VPNAccountComments, VPNAccountStatusHistory } from './VPNAccountDetailPanels';
import { useToast } from '@/hooks/useToast';
import Toast from '@/components/Toast';
import { fetchWithCsrf } from '@/lib/csrf';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Info, User, Clock, Shield, History } from 'lucide-react';

interface VPNAccountDetailModalProps {
  accountId: string;
  onClose: () => void;
  onRefresh?: () => void;
}

const getStatusBadge = (status: string) => {
   switch(status) {
     case 'active': return <Badge className="bg-green-100 dark:bg-green-950/60 text-green-800 border-green-200 dark:border-green-900">Active</Badge>;
     case 'pending_faculty': return <Badge className="bg-yellow-100 dark:bg-yellow-950/60 text-yellow-800 border-yellow-200 dark:border-yellow-900">Pending Faculty</Badge>;
     case 'disabled': return <Badge variant="destructive" className="bg-red-100 dark:bg-red-950/60 text-red-800 border-red-200 dark:border-red-900">Disabled</Badge>;
     case 'revoked': return <Badge variant="destructive" className="bg-purple-100 dark:bg-purple-950/60 text-purple-800 border-purple-200 dark:border-purple-900">Revoked</Badge>;
     default: return <Badge variant="outline">{status}</Badge>;
   }
};

const getPortalBadge = (portalType: string) => {
  switch(portalType) {
    case 'Management': return <Badge variant="outline" className="bg-blue-100 dark:bg-blue-950/60 text-blue-800 border-blue-200 dark:border-blue-900">Management</Badge>;
    case 'Limited': return <Badge variant="outline" className="bg-purple-100 dark:bg-purple-950/60 text-purple-800 border-purple-200 dark:border-purple-900">Limited</Badge>;
    case 'External': return <Badge variant="outline" className="bg-orange-100 dark:bg-orange-950/60 text-orange-800 border-orange-200 dark:border-orange-900">External</Badge>;
    default: return <Badge variant="outline">{portalType}</Badge>;
  }
};

export default function VPNAccountDetailModal({ accountId, onClose }: VPNAccountDetailModalProps) {
  const { toast, showToast, hideToast } = useToast();
  const [account, setAccount] = useState<VPNAccountDetail | null>(null);
  const [comments, setComments] = useState<VPNAccountComment[]>([]);
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

  if (loading) {
    return (
      <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
        <DialogContent>
           <DialogHeader>
             <DialogTitle>Loading VPN account details</DialogTitle>
           </DialogHeader>
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
           <DialogHeader>
             <DialogTitle>VPN account unavailable</DialogTitle>
           </DialogHeader>
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
                  <h3 className="text-2xl font-bold text-foreground mb-1">{account.name}</h3>
                  <div className="flex items-center gap-2 text-muted-foreground mb-2">
                    <User className="w-4 h-4" />
                    <span className="font-mono text-sm">{account.username}</span>
                  </div>
                  <div className="flex items-center gap-2 text-muted-foreground">
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
                       <Badge variant="secondary" className="bg-blue-100/50 text-blue-800 hover:bg-blue-100 dark:bg-blue-950/60">Internal</Badge>
                    ) : ( 
                       <Badge variant="secondary" className="bg-purple-100/50 text-purple-800 hover:bg-purple-100 dark:bg-purple-950/60">External</Badge>
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
                  <CardHeader className="py-3 bg-muted/50 border-b">
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
                  <CardHeader className="py-3 bg-muted/50 border-b">
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

                <VPNAccountStatusHistory account={account} />

                {account.notes && (
                  <Card>
                    <CardHeader className="py-3 bg-muted/50 border-b">
                      <CardTitle className="text-base">Notes</CardTitle>
                    </CardHeader>
                    <CardContent className="p-4">
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap">{account.notes}</p>
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardHeader className="py-3 bg-muted/50 border-b">
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

              <VPNAccountTimeline account={account} loadingComments={loadingComments} />

              <VPNAccountComments comments={comments} loadingComments={loadingComments} newComment={newComment} submittingComment={submittingComment} onCommentChange={setNewComment} onSubmit={handleAddComment} />
            </div>
          </Tabs>
        </div>

        <div className="flex justify-end gap-3 pt-4 border-t mt-4">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>
        <Toast {...toast} onClose={hideToast} />
      </DialogContent>
    </Dialog>
  );
}
