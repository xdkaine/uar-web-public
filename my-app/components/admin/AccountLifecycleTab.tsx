'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { usePolling } from '@/hooks/usePolling';
import { useToast } from '@/hooks/useToast';
import { fetchWithCsrf } from '@/lib/csrf';
import GroupManagementModal from './GroupManagementModal';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { 
  Search, 
  Plus, 
  Users, 
  RefreshCw, 
  ToggleLeft, 
  ToggleRight, 
  Filter, 
  X, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  Play, 
  Trash2, 
  History,
  ChevronDown,
  ChevronUp,
  MoreHorizontal
} from "lucide-react";
import { cn } from "@/lib/utils";

interface LifecycleAction {
  id: string;
  createdAt: string;
  actionType: string;
  targetAccountType: string;
  targetUsername: string;
  status: string;
  reason: string;
  requestedBy: string;
  queuePosition: number | null;
  scheduledFor: string | null;
  processedAt: string | null;
  completedAt: string | null;
  errorMessage: string | null;
  adDisabled: boolean;
  vpnDisabled: boolean;
  vpnRoleChange: string | null;
  relatedRequestId: string | null;
  relatedTicketId: string | null;
  notes: string | null;
   batch: unknown | null;
  history: Array<{
    id: string;
    createdAt: string;
    event: string;
    details: string | null;
    performedBy: string | null;
  }>;
}

type StatusFilter = 'all' | 'pending' | 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
type ActionTypeFilter = 'all' | 'disable_ad' | 'enable_ad' | 'revoke_vpn' | 'restore_vpn' | 'promote_vpn_role' | 'demote_vpn_role' | 'disable_both' | 'enable_both' | 'add_to_group' | 'remove_from_group';
type AccountTypeFilter = 'all' | 'AD' | 'VPN' | 'BOTH';

interface UserSummary {
  username: string;
  displayName: string;
  email: string;
  accountEnabled: boolean;
  dn: string;
  vpnDetails: { status: string; portalType: string } | null;
}

export default function AccountLifecycleTab() {
  const router = useRouter();
  const { showToast } = useToast();
  
  const [actions, setActions] = useState<LifecycleAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  
  // Filters and search
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [actionTypeFilter, setActionTypeFilter] = useState<ActionTypeFilter>('all');
  const [accountTypeFilter, setAccountTypeFilter] = useState<AccountTypeFilter>('all');
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  
  // Sorting and pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortField, setSortField] = useState<'createdAt' | 'status'>('createdAt');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  
  // Expanded actions for showing history
  const [expandedActions, setExpandedActions] = useState<Set<string>>(new Set());
  
  // Create action form state
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
  const [actionType, setActionType] = useState('disable_ad');
  const [targetAccountType, setTargetAccountType] = useState('AD');
  const [targetUsername, setTargetUsername] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [relatedRequestId, setRelatedRequestId] = useState('');
  const [relatedTicketId, setRelatedTicketId] = useState('');

  // Confirmation Dialog States
  const [actionToDelete, setActionToDelete] = useState<{ id: string, targetUsername: string } | null>(null);
  const [isProcessAllInfoOpen, setIsProcessAllInfoOpen] = useState(false);

  // User List State (paginated list instead of autocomplete)
  const [availableUsers, setAvailableUsers] = useState<UserSummary[]>([]);
  const [isUserLoading, setIsUserLoading] = useState(false);
  const [userListPage, setUserListPage] = useState(1);
  const [userListSearch, setUserListSearch] = useState('');
  const userListPageSize = 5;

  // Fetch Actions using usePolling
  const fetchLifecycleActions = useCallback(async () => {
    const res = await fetchWithCsrf('/api/admin/account-lifecycle');
    if (!res.ok) throw new Error('Failed to fetch actions');
    return await res.json();
  }, []);

  const { 
    data: polledData, 
    isLoading: isPollingLoading, 
    isPolling, 
    togglePolling, 
    refresh,
    lastUpdated
  } = usePolling(fetchLifecycleActions, {
    onSuccess: (data) => {
      setActions(data.actions || []);
      setLoading(false);
    },
    onError: (error) => {
      console.error('Error loading data:', error);
      // Only show toast on initial load error, not polling error to avoid spam
      if (loading) {
        showToast('Failed to load lifecycle data', 'error');
        setLoading(false);
      }
    }
  });

  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    setIsUserLoading(true);
    try {
      const res = await fetchWithCsrf('/api/admin/users');
      if (res.ok) {
        const data = await res.json();
        // API now returns rich user objects directly
        setAvailableUsers(data.users || []);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      // Don't show toast here to avoid spamming if it fails silently
    } finally {
      setIsUserLoading(false);
    }
  };

  // Filter and sort actions
  const filteredActions = useMemo(() => {
    return actions.filter(action => {
      // Text search filter
      const searchLower = searchQuery.toLowerCase();
      const matchesSearch = !searchQuery || (
        action.targetUsername.toLowerCase().includes(searchLower) ||
        action.reason.toLowerCase().includes(searchLower) ||
        action.requestedBy.toLowerCase().includes(searchLower) ||
        (action.notes && action.notes.toLowerCase().includes(searchLower)) ||
        (action.relatedRequestId && action.relatedRequestId.toLowerCase().includes(searchLower)) ||
        (action.relatedTicketId && action.relatedTicketId.toLowerCase().includes(searchLower)) ||
        action.id.toLowerCase().includes(searchLower)
      );

      // Status filter
      const matchesStatus = statusFilter === 'all' || action.status === statusFilter;

      // Action type filter
      const matchesActionType = actionTypeFilter === 'all' || action.actionType === actionTypeFilter;

      // Account type filter
      const matchesAccountType = accountTypeFilter === 'all' || action.targetAccountType === accountTypeFilter;

      return matchesSearch && matchesStatus && matchesActionType && matchesAccountType;
    });
  }, [actions, searchQuery, statusFilter, actionTypeFilter, accountTypeFilter]);

  // Sort actions
  const sortedActions = useMemo(() => {
    return [...filteredActions].sort((a, b) => {
      let aValue: string | number = '';
      let bValue: string | number = '';

      switch (sortField) {
        case 'createdAt':
          aValue = new Date(a.createdAt).getTime();
          bValue = new Date(b.createdAt).getTime();
          break;
        case 'status':
          aValue = a.status.toLowerCase();
          bValue = b.status.toLowerCase();
          break;
      }

      if (aValue < bValue) return sortDirection === 'asc' ? -1 : 1;
      if (aValue > bValue) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });
  }, [filteredActions, sortField, sortDirection]);

  // Pagination
  const totalPages = Math.ceil(sortedActions.length / pageSize);
  const paginatedActions = sortedActions.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize
  );

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const toggleActionHistory = (actionId: string) => {
    const newExpanded = new Set(expandedActions);
    if (newExpanded.has(actionId)) {
      newExpanded.delete(actionId);
    } else {
      newExpanded.add(actionId);
    }
    setExpandedActions(newExpanded);
  };

  // Statistics
  const totalActions = actions.length;
  const queuedActions = actions.filter(a => a.status === 'queued').length;
  const pendingActions = actions.filter(a => a.status === 'pending').length;
  const processingActions = actions.filter(a => a.status === 'processing').length;
  const completedActions = actions.filter(a => a.status === 'completed').length;
  const failedActions = actions.filter(a => a.status === 'failed').length;

  const handleCreateAction = async () => {
    if (!targetUsername.trim() || !reason.trim()) {
      showToast('Username and reason are required', 'error');
      return;
    }

    try {
      const res = await fetchWithCsrf('/api/admin/account-lifecycle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          actionType,
          targetAccountType,
          targetUsername: targetUsername.trim(),
          reason: reason.trim(),
          notes: notes.trim() || undefined,
          relatedRequestId: relatedRequestId.trim() || undefined,
          relatedTicketId: relatedTicketId.trim() || undefined,
        }),
      });

      const data = await res.json();

      if (res.ok) {
        showToast('Lifecycle action created and queued', 'success');
        // Reset form
        setTargetUsername('');
        setReason('');
        setNotes('');
        setRelatedRequestId('');
        setRelatedTicketId('');
        setIsCreateModalOpen(false);
        refresh();
      } else {
        showToast(data.error || 'Failed to create lifecycle action', 'error');
      }
    } catch (error) {
      console.error('Error creating action:', error);
      showToast('Failed to create lifecycle action', 'error');
    }
  };

  const processNextAction = async () => {
    setProcessing(true);
    try {
      const res = await fetchWithCsrf('/api/admin/account-lifecycle/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (res.ok) {
        if (data.result) {
          showToast(
            data.result.success ? 'Action processed successfully' : 'Action processing failed',
            data.result.success ? 'success' : 'error'
          );
        } else {
          showToast('No actions in queue', 'info');
        }
        refresh();
      } else {
        showToast(data.error || 'Failed to process action', 'error');
      }
    } catch (error) {
      console.error('Error processing action:', error);
      showToast('Failed to process action', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const processAllActions = async () => {
    setIsProcessAllInfoOpen(false);
    setProcessing(true);
    try {
      const res = await fetchWithCsrf('/api/admin/account-lifecycle/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ processAll: true }),
      });

      const data = await res.json();

      if (res.ok) {
        showToast(
          `Processed ${data.summary?.total || 0} actions. ${data.summary?.successful || 0} successful, ${data.summary?.failed || 0} failed.`,
          'success'
        );
        refresh();
      } else {
        showToast(data.error || 'Failed to process actions', 'error');
      }
    } catch (error) {
      console.error('Error processing actions:', error);
      showToast('Failed to process actions', 'error');
    } finally {
      setProcessing(false);
    }
  };

  const deleteAction = async () => {
    if (!actionToDelete) return;

    try {
      const res = await fetchWithCsrf(`/api/admin/account-lifecycle/${actionToDelete.id}`, {
        method: 'DELETE',
      });

      const data = await res.json();

      if (res.ok) {
        showToast('Action deleted successfully', 'success');
        refresh();
      } else {
        showToast(data.error || 'Failed to delete action', 'error');
      }
    } catch (error) {
      console.error('Error deleting action:', error);
      showToast('Failed to delete action', 'error');
    } finally {
      setActionToDelete(null);
    }
  };

  const getActionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      disable_ad: 'Disable AD',
      enable_ad: 'Enable AD',
      revoke_vpn: 'Revoke VPN',
      restore_vpn: 'Restore VPN',
      promote_vpn_role: 'Promote VPN Role',
      demote_vpn_role: 'Demote VPN Role',
      disable_both: 'Disable AD & VPN',
      enable_both: 'Enable AD & VPN',
      add_to_group: 'Add to Group',
      remove_from_group: 'Remove from Group',
    };
    return labels[type] || type;
  };

  const getStatusBadge = (status: string) => {
    const variants: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
      pending: "secondary",
      queued: "default", 
      processing: "default",
      completed: "default",
      failed: "destructive",
      cancelled: "outline",
    };
    
    // Custom colors using generic Badge
    let className = "";
    if (status === 'queued') className = "bg-blue-500 hover:bg-blue-600";
    if (status === 'processing') className = "bg-yellow-500 hover:bg-yellow-600 animate-pulse text-black";
    if (status === 'completed') className = "bg-green-500 hover:bg-green-600";
    if (status === 'pending') className = "bg-gray-500 hover:bg-gray-600";

    return (
      <Badge variant={variants[status] || "secondary"} className={className}>
        {status.toUpperCase()}
      </Badge>
    );
  };

  // Filtered users for paginated list
  const filteredUsers = useMemo(() => {
    return availableUsers.filter((u: UserSummary) => {
      // 1. Action Applicability Filter
      let isApplicable = false;
      const vpn = u.vpnDetails;
      const hasAd = !!u.dn;

      switch (actionType) {
        case 'disable_ad':
          isApplicable = !!(hasAd && u.accountEnabled);
          break;
        case 'enable_ad':
          isApplicable = !!(hasAd && !u.accountEnabled);
          break;
        case 'revoke_vpn':
          isApplicable = !!(vpn && vpn.status !== 'revoked' && vpn.status !== 'disabled');
          break;
        case 'restore_vpn':
          isApplicable = !!(vpn && (vpn.status === 'revoked' || vpn.status === 'disabled'));
          break;
        case 'promote_vpn_role':
          isApplicable = !!(vpn && vpn.portalType !== 'Management');
          break;
        case 'demote_vpn_role':
          isApplicable = !!(vpn && vpn.portalType === 'Management');
          break;
        case 'disable_both':
           isApplicable = !!((hasAd && u.accountEnabled) || (vpn && vpn.status !== 'revoked'));
           break;
        case 'enable_both':
           isApplicable = !!((hasAd && !u.accountEnabled) || (vpn && vpn.status === 'revoked'));
           break;
        default:
          isApplicable = true;
      }

      if (!isApplicable) return false;

      // 2. Text search filter (for the list search input)
      if (userListSearch) {
        const searchLower = userListSearch.toLowerCase();
        return u.username.toLowerCase().includes(searchLower) || 
               u.displayName.toLowerCase().includes(searchLower) ||
               u.email.toLowerCase().includes(searchLower);
      }

      return true;
    });
  }, [userListSearch, availableUsers, actionType]);

  // Pagination for user list
  const userListTotalPages = Math.ceil(filteredUsers.length / userListPageSize);
  const paginatedUsers = filteredUsers.slice(
    (userListPage - 1) * userListPageSize,
    userListPage * userListPageSize
  );

  // Reset to page 1 when filters change
  useEffect(() => {
    setUserListPage(1);
  }, [userListSearch, actionType]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
           <h2 className="text-2xl font-bold tracking-tight text-gray-900">Account Lifecycle Actions</h2>
           <p className="text-muted-foreground">Manage user onboarding, offboarding, and access changes.</p>
        </div>
        <div className="flex items-center gap-3">
           <Button onClick={() => setIsCreateModalOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" /> Create Action
           </Button>
           <Button variant="secondary" onClick={() => setIsGroupModalOpen(true)} className="gap-2">
              <Users className="w-4 h-4" /> Manage Groups
           </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-6 gap-3 sm:gap-4">
        <Card className="shadow-sm">
           <CardContent className="p-4 sm:p-6 flex flex-col items-center text-center">
              <span className="text-xs font-medium text-muted-foreground uppercase">Total</span>
              <span className="text-2xl font-bold">{totalActions}</span>
           </CardContent>
        </Card>
        <Card className="shadow-sm border-blue-100 bg-blue-50/20">
           <CardContent className="p-4 sm:p-6 flex flex-col items-center text-center">
              <span className="text-xs font-medium text-blue-600 uppercase">Queued</span>
              <span className="text-2xl font-bold text-blue-700">{queuedActions}</span>
           </CardContent>
        </Card>
        <Card className="shadow-sm">
           <CardContent className="p-4 sm:p-6 flex flex-col items-center text-center">
              <span className="text-xs font-medium text-muted-foreground uppercase">Pending</span>
              <span className="text-2xl font-bold text-gray-700">{pendingActions}</span>
           </CardContent>
        </Card>
        <Card className="shadow-sm border-yellow-100 bg-yellow-50/20">
           <CardContent className="p-4 sm:p-6 flex flex-col items-center text-center">
              <span className="text-xs font-medium text-yellow-600 uppercase">Processing</span>
              <span className="text-2xl font-bold text-yellow-700">{processingActions}</span>
           </CardContent>
        </Card>
        <Card className="shadow-sm border-green-100 bg-green-50/20">
           <CardContent className="p-4 sm:p-6 flex flex-col items-center text-center">
              <span className="text-xs font-medium text-green-600 uppercase">Completed</span>
              <span className="text-2xl font-bold text-green-700">{completedActions}</span>
           </CardContent>
        </Card>
        <Card className="shadow-sm border-red-100 bg-red-50/20">
           <CardContent className="p-4 sm:p-6 flex flex-col items-center text-center">
              <span className="text-xs font-medium text-red-600 uppercase">Failed</span>
              <span className="text-2xl font-bold text-red-700">{failedActions}</span>
           </CardContent>
        </Card>
      </div>

      <div className="flex flex-col sm:flex-row justify-end items-start sm:items-center gap-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {lastUpdated && (
            <span>Updated: {lastUpdated.toLocaleTimeString()}</span>
          )}
        </div>
        
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={togglePolling}
            className={`gap-2 ${isPolling ? 'text-green-600 border-green-200 bg-green-50' : ''}`}
          >
            <div className={`w-2 h-2 rounded-full ${isPolling ? 'bg-green-500 animate-pulse' : 'bg-gray-400'}`} />
            {isPolling ? 'Live Updates On' : 'Live Updates Off'}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => refresh()}
            disabled={isPollingLoading}
            className="gap-2"
          >
            <RefreshCw className={`w-3 h-3 ${isPollingLoading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
         <CardContent className="p-6">
            <div className="flex gap-3 mb-4 flex-wrap md:flex-nowrap">
               <div className="flex-1 min-w-[200px]">
                  <div className="relative">
                     <Input 
                        placeholder="Search by username, request ID, reason, or notes..." 
                        value={searchQuery}
                        onChange={(e) => {
                           setSearchQuery(e.target.value);
                           setCurrentPage(1);
                        }}
                        className="pl-9"
                     />
                     <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
                  </div>
               </div>
               
               <div className="flex gap-2">
                  <Button
                     onClick={processNextAction}
                     disabled={processing || queuedActions === 0}
                     className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                     {processing ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <Play className="w-4 h-4 mr-2" />}
                     {processing ? 'Processing...' : 'Process Next'}
                  </Button>
                  <Button
                     variant="default"
                     onClick={() => setIsProcessAllInfoOpen(true)}
                     disabled={processing || queuedActions === 0}
                     className="bg-green-600 hover:bg-green-700 text-white"
                  >
                     <Play className="w-4 h-4 mr-2" /> Process All
                  </Button>
                  <Button
                     variant={showAdvancedFilters ? "default" : "secondary"}
                     onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                     className="gap-2"
                  >
                     <Filter className="w-4 h-4" />
                     Filters
                  </Button>
                  {(searchQuery || statusFilter !== 'all' || actionTypeFilter !== 'all' || accountTypeFilter !== 'all') && (
                     <Button
                        variant="ghost"
                        onClick={() => {
                           setSearchQuery('');
                           setStatusFilter('all');
                           setActionTypeFilter('all');
                           setAccountTypeFilter('all');
                           setCurrentPage(1);
                        }}
                        className="text-red-600 hover:text-red-700 hover:bg-red-50"
                     >
                        <X className="w-4 h-4 mr-2" /> Clear
                     </Button>
                  )}
               </div>
            </div>

            {showAdvancedFilters && (
               <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4 border-t">
                  <div className="space-y-2">
                     <Label>Status</Label>
                     <Select value={statusFilter} onValueChange={(val) => { setStatusFilter(val as StatusFilter); setCurrentPage(1); }}>
                        <SelectTrigger>
                           <SelectValue placeholder="All Status" />
                        </SelectTrigger>
                        <SelectContent>
                           <SelectItem value="all">All Status</SelectItem>
                           <SelectItem value="pending">Pending</SelectItem>
                           <SelectItem value="queued">Queued</SelectItem>
                           <SelectItem value="processing">Processing</SelectItem>
                           <SelectItem value="completed">Completed</SelectItem>
                           <SelectItem value="failed">Failed</SelectItem>
                           <SelectItem value="cancelled">Cancelled</SelectItem>
                        </SelectContent>
                     </Select>
                  </div>
                  <div className="space-y-2">
                     <Label>Action Type</Label>
                     <Select value={actionTypeFilter} onValueChange={(val) => { setActionTypeFilter(val as ActionTypeFilter); setCurrentPage(1); }}>
                        <SelectTrigger>
                           <SelectValue placeholder="All Actions" />
                        </SelectTrigger>
                        <SelectContent className="max-h-[300px]">
                           <SelectItem value="all">All Actions</SelectItem>
                           <SelectItem value="disable_ad">Disable AD</SelectItem>
                           <SelectItem value="enable_ad">Enable AD</SelectItem>
                           <SelectItem value="revoke_vpn">Revoke VPN</SelectItem>
                           <SelectItem value="restore_vpn">Restore VPN</SelectItem>
                           <SelectItem value="promote_vpn_role">Promote VPN Role</SelectItem>
                           <SelectItem value="demote_vpn_role">Demote VPN Role</SelectItem>
                           <SelectItem value="disable_both">Disable Both</SelectItem>
                           <SelectItem value="enable_both">Enable Both</SelectItem>
                           <SelectItem value="add_to_group">Add to Group</SelectItem>
                           <SelectItem value="remove_from_group">Remove from Group</SelectItem>
                        </SelectContent>
                     </Select>
                  </div>
                  <div className="space-y-2">
                     <Label>Target Account Type</Label>
                     <Select value={accountTypeFilter} onValueChange={(val) => { setAccountTypeFilter(val as AccountTypeFilter); setCurrentPage(1); }}>
                        <SelectTrigger>
                           <SelectValue placeholder="All Types" />
                        </SelectTrigger>
                        <SelectContent>
                           <SelectItem value="all">All Types</SelectItem>
                           <SelectItem value="AD">Active Directory</SelectItem>
                           <SelectItem value="VPN">VPN Only</SelectItem>
                           <SelectItem value="BOTH">Both AD & VPN</SelectItem>
                        </SelectContent>
                     </Select>
                  </div>
               </div>
            )}
         </CardContent>
      </Card>

      {loading ? (
        <div className="flex justify-center py-12">
            <div className="flex items-center gap-2 text-muted-foreground">
                <RefreshCw className="w-5 h-5 animate-spin" />
                <span>Loading actions...</span>
            </div>
        </div>
      ) : sortedActions.length === 0 ? (
        <Card>
           <CardContent className="p-12 text-center text-muted-foreground">
              {filteredActions.length === 0 && actions.length > 0
                ? 'No actions match your filters'
                : 'No lifecycle actions in queue'}
           </CardContent>
        </Card>
      ) : (
        <>
          <div className="space-y-3">
             {paginatedActions.map((action) => (
                <Card 
                  key={action.id} 
                  className={cn(
                    "overflow-hidden hover:shadow-md transition-all border-l-4",
                    action.status === 'failed' ? 'border-l-red-500' : 
                    action.status === 'completed' ? 'border-l-green-500' : 
                    action.status === 'queued' ? 'border-l-blue-500' : 
                    'border-l-gray-200'
                  )}
                >
                   <div className="p-4 sm:p-5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                         <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                               <h3 className="text-lg font-bold text-gray-900">{action.targetUsername}</h3>
                               {getStatusBadge(action.status)}
                               <Badge variant="outline" className="text-muted-foreground">{getActionTypeLabel(action.actionType)}</Badge>
                               <span className="text-xs text-muted-foreground ml-2">ID: {action.id.slice(0, 8)}</span>
                            </div>
                            <p className="text-sm text-gray-600">
                               <span className="font-medium">Reason:</span> {action.reason}
                            </p>
                            <div className="flex items-center gap-4 text-xs text-muted-foreground pt-1">
                               <div className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  Created {new Date(action.createdAt).toLocaleString()} by {action.requestedBy}
                               </div>
                               {action.queuePosition !== null && action.status === 'queued' && (
                                  <Badge variant="secondary" className="text-[10px] h-5">Queue Position: #{action.queuePosition}</Badge>
                               )}
                            </div>
                         </div>
                         
                         <div className="flex items-center gap-2">
                             {(action.status === 'pending' || action.status === 'queued' || action.status === 'failed') && (
                                <Button 
                                   variant="ghost" 
                                   size="icon"
                                   onClick={() => setActionToDelete({ id: action.id, targetUsername: action.targetUsername })}
                                   className="text-red-500 hover:text-red-700 hover:bg-red-50"
                                >
                                   <Trash2 className="w-4 h-4" />
                                </Button>
                             )}
                             <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => toggleActionHistory(action.id)}
                             >
                                {expandedActions.has(action.id) ? 'Hide Details' : 'Show Details'}
                                {expandedActions.has(action.id) ? <ChevronUp className="w-4 h-4 ml-1" /> : <ChevronDown className="w-4 h-4 ml-1" />}
                             </Button>
                         </div>
                      </div>

                      {expandedActions.has(action.id) && (
                         <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-1 md:grid-cols-2 gap-6 bg-muted/20 -mx-5 -mb-5 p-5">
                            <div className="space-y-4">
                               <div>
                                  <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Target Details</h4>
                                  <div className="grid grid-cols-2 gap-2 text-sm bg-white p-3 rounded-lg border">
                                     <span className="text-muted-foreground">Account Type:</span>
                                     <span className="font-medium">{action.targetAccountType}</span>
                                     <span className="text-muted-foreground">Notes:</span>
                                     <span className="font-medium whitespace-pre-wrap wrap-break-word">{action.notes || '-'}</span>
                                     <span className="text-muted-foreground">Related Request:</span>
                                     <span className="font-medium wrap-break-word">{action.relatedRequestId || '-'}</span>
                                     <span className="text-muted-foreground">Related Ticket:</span>
                                     <span className="font-medium wrap-break-word">{action.relatedTicketId || '-'}</span>
                                  </div>
                               </div>
                               
                               {action.errorMessage && (
                                  <div>
                                     <h4 className="text-xs font-bold uppercase text-red-500 mb-2">Error Details</h4>
                                     <div className="p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700 whitespace-pre-wrap wrap-break-word">
                                        <AlertTriangle className="w-4 h-4 mb-1 inline mr-2" />
                                        {action.errorMessage}
                                     </div>
                                  </div>
                               )}
                            </div>

                            <div>
                               <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Processing History</h4>
                               <div className="space-y-3 bg-white p-3 rounded-lg border max-h-[200px] overflow-y-auto">
                                  {action.history && action.history.length > 0 ? (
                                     action.history.map((hist) => (
                                        <div key={hist.id} className="text-sm border-l-2 border-gray-200 pl-3 py-1 relative">
                                           <div className="absolute -left-[5px] top-2 w-2 h-2 rounded-full bg-gray-300"></div>
                                           <div className="flex justify-between">
                                              <span className="font-semibold text-gray-700">{hist.event}</span>
                                              <span className="text-xs text-muted-foreground">{new Date(hist.createdAt).toLocaleString()}</span>
                                           </div>
                                           {hist.details && <p className="text-gray-600 text-xs mt-1 whitespace-pre-wrap wrap-break-word">{hist.details}</p>}
                                           {hist.performedBy && <p className="text-xs text-muted-foreground mt-0.5 wrap-break-word">By: {hist.performedBy}</p>}
                                        </div>
                                     ))
                                  ) : (
                                     <p className="text-sm text-muted-foreground italic">No history recorded yet</p>
                                  )}
                               </div>
                            </div>
                         </div>
                      )}
                   </div>
                </Card>
             ))}
          </div>
          
          {totalPages > 1 && (
             <div className="flex justify-center mt-6">
                <div className="flex items-center gap-2">
                   <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                   >
                      Previous
                   </Button>
                   <span className="text-sm font-medium">Page {currentPage} of {totalPages}</span>
                   <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                   >
                      Next
                   </Button>
                </div>
             </div>
          )}
        </>
      )}

      <GroupManagementModal 
        isOpen={isGroupModalOpen} 
        onClose={() => setIsGroupModalOpen(false)} 
      />

      <Dialog open={isCreateModalOpen} onOpenChange={setIsCreateModalOpen}>
        <DialogContent className="max-w-2xl h-[80vh] flex flex-col p-0 gap-0 overflow-hidden">
             <DialogHeader className="p-6 pb-4 border-b">
                <DialogTitle>Create Account Lifecycle Action</DialogTitle>
                <DialogDescription>
                   Schedule automated actions for user accounts.
                </DialogDescription>
             </DialogHeader>
             
             <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-2">
                      <Label>Action Type</Label>
                      <Select value={actionType} onValueChange={setActionType}>
                         <SelectTrigger>
                            <SelectValue placeholder="Select Action" />
                         </SelectTrigger>
                         <SelectContent>
                            <SelectItem value="disable_ad">Disable AD Account</SelectItem>
                            <SelectItem value="enable_ad">Enable AD Account</SelectItem>
                            <SelectItem value="revoke_vpn">Revoke VPN Access</SelectItem>
                            <SelectItem value="restore_vpn">Restore VPN Access</SelectItem>
                            <SelectItem value="promote_vpn_role">Promote VPN Role (to Management)</SelectItem>
                            <SelectItem value="demote_vpn_role">Demote VPN Role (to User)</SelectItem>
                            <SelectItem value="disable_both">Disable Both (Offboard)</SelectItem>
                            <SelectItem value="enable_both">Enable Both</SelectItem>
                         </SelectContent>
                      </Select>
                   </div>
                   <div className="space-y-2">
                      <Label>Target Account Type</Label>
                      <Select value={targetAccountType} onValueChange={setTargetAccountType}>
                         <SelectTrigger>
                            <SelectValue placeholder="Select Type" />
                         </SelectTrigger>
                         <SelectContent>
                            <SelectItem value="AD">Active Directory</SelectItem>
                            <SelectItem value="VPN">VPN Only</SelectItem>
                            <SelectItem value="BOTH">Both AD & VPN</SelectItem>
                         </SelectContent>
                      </Select>
                   </div>
                </div>

                <div className="space-y-3">
                   <Label>Target Username</Label>
                   
                   <div className="relative">
                      <Input 
                         placeholder="Search users by name, username, or email..." 
                         value={userListSearch}
                         onChange={(e) => setUserListSearch(e.target.value)}
                         className="pl-9"
                      />
                      <Search className="w-4 h-4 absolute left-3 top-2.5 text-muted-foreground" />
                   </div>

                   {isUserLoading ? (
                      <div className="flex items-center justify-center py-8 text-muted-foreground">
                         <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                         Loading users...
                      </div>
                   ) : filteredUsers.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground border rounded-md bg-muted/20">
                         {userListSearch ? 'No users match your search' : 'No applicable users found for this action type'}
                      </div>
                   ) : (
                      <div className="border rounded-md overflow-hidden">
                         <div className="max-h-[200px] overflow-y-auto">
                            <table className="w-full text-sm">
                               <thead className="bg-muted/50 sticky top-0">
                                  <tr className="border-b">
                                     <th className="w-10 p-2"></th>
                                     <th className="text-left p-2 font-medium">Username</th>
                                     <th className="text-left p-2 font-medium">Display Name</th>
                                     <th className="text-right p-2 font-medium">Status</th>
                                  </tr>
                               </thead>
                               <tbody>
                                  {paginatedUsers.map((user) => (
                                     <tr 
                                        key={user.username}
                                        onClick={() => setTargetUsername(user.username)}
                                        className={cn(
                                           "border-b last:border-0 cursor-pointer transition-colors",
                                           targetUsername === user.username 
                                              ? "bg-primary/10 hover:bg-primary/15" 
                                              : "hover:bg-muted/50"
                                        )}
                                     >
                                        <td className="p-2 text-center">
                                           <div className={cn(
                                              "w-4 h-4 rounded-full border-2 mx-auto flex items-center justify-center",
                                              targetUsername === user.username 
                                                 ? "border-primary bg-primary" 
                                                 : "border-gray-300"
                                           )}>
                                              {targetUsername === user.username && (
                                                 <div className="w-1.5 h-1.5 rounded-full bg-white" />
                                              )}
                                           </div>
                                        </td>
                                        <td className="p-2 font-mono text-xs">{user.username}</td>
                                        <td className="p-2">{user.displayName}</td>
                                        <td className="p-2 text-right">
                                           <div className="flex items-center justify-end gap-1">
                                              {user.dn && (
                                                 <Badge variant="outline" className={cn(
                                                    "text-[10px] px-1.5",
                                                    user.accountEnabled ? "text-green-600 border-green-200" : "text-red-600 border-red-200"
                                                 )}>
                                                    AD {user.accountEnabled ? '✓' : '✗'}
                                                 </Badge>
                                              )}
                                              {user.vpnDetails && (
                                                 <Badge variant="outline" className={cn(
                                                    "text-[10px] px-1.5",
                                                    user.vpnDetails.status !== 'revoked' && user.vpnDetails.status !== 'disabled'
                                                       ? "text-green-600 border-green-200" 
                                                       : "text-red-600 border-red-200"
                                                 )}>
                                                    VPN {user.vpnDetails.status !== 'revoked' && user.vpnDetails.status !== 'disabled' ? '✓' : '✗'}
                                                 </Badge>
                                              )}
                                           </div>
                                        </td>
                                     </tr>
                                  ))}
                               </tbody>
                            </table>
                         </div>

                         {userListTotalPages > 1 && (
                            <div className="flex items-center justify-between px-3 py-2 border-t bg-muted/30">
                               <span className="text-xs text-muted-foreground">
                                  {filteredUsers.length} user{filteredUsers.length !== 1 ? 's' : ''} found
                               </span>
                               <div className="flex items-center gap-2">
                                  <Button
                                     variant="ghost"
                                     size="sm"
                                     onClick={() => setUserListPage(p => Math.max(1, p - 1))}
                                     disabled={userListPage === 1}
                                     className="h-7 px-2 text-xs"
                                  >
                                     Previous
                                  </Button>
                                  <span className="text-xs font-medium">
                                     {userListPage} / {userListTotalPages}
                                  </span>
                                  <Button
                                     variant="ghost"
                                     size="sm"
                                     onClick={() => setUserListPage(p => Math.min(userListTotalPages, p + 1))}
                                     disabled={userListPage === userListTotalPages}
                                     className="h-7 px-2 text-xs"
                                  >
                                     Next
                                  </Button>
                               </div>
                            </div>
                         )}
                      </div>
                   )}

                   {targetUsername && (
                      <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-md">
                         <CheckCircle2 className="w-4 h-4 text-green-600" />
                         <span className="text-sm">
                            <span className="font-medium">Selected:</span>{' '}
                            {availableUsers.find(u => u.username === targetUsername)?.displayName || targetUsername}
                            {' '}(<span className="font-mono text-xs">{targetUsername}</span>)
                         </span>
                         <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setTargetUsername('')}
                            className="ml-auto h-6 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                         >
                            Clear
                         </Button>
                      </div>
                   )}
                </div>

                <div className="space-y-2">
                   <Label>Reason</Label>
                   <Textarea 
                      placeholder="Why is this action being taken?" 
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                   />
                </div>

                <Accordion type="single" collapsible className="w-full">
                   <AccordionItem value="item-1">
                      <AccordionTrigger>Optional Details</AccordionTrigger>
                      <AccordionContent className="space-y-4 pt-4">
                         <div className="grid grid-cols-2 gap-4">
                            <div className="space-y-2">
                               <Label>Related Request ID</Label>
                               <Input 
                                  placeholder="REQ-12345" 
                                  value={relatedRequestId}
                                  onChange={(e) => setRelatedRequestId(e.target.value)}
                               />
                            </div>
                            <div className="space-y-2">
                               <Label>Related Ticket ID</Label>
                               <Input 
                                  placeholder="TICKET-789" 
                                  value={relatedTicketId}
                                  onChange={(e) => setRelatedTicketId(e.target.value)}
                               />
                            </div>
                         </div>
                         <div className="space-y-2">
                            <Label>Internal Notes</Label>
                            <Textarea 
                               placeholder="Additional context..." 
                               value={notes}
                               onChange={(e) => setNotes(e.target.value)}
                            />
                         </div>
                      </AccordionContent>
                   </AccordionItem>
                </Accordion>
             </div>

             <DialogFooter className="p-6 pt-4 border-t">
                <Button variant="outline" onClick={() => setIsCreateModalOpen(false)}>Cancel</Button>
                <Button onClick={handleCreateAction}>Create Action</Button>
             </DialogFooter>
        </DialogContent>
      </Dialog>
      
      <AlertDialog open={!!actionToDelete} onOpenChange={(open) => !open && setActionToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Action?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete the action for <strong>{actionToDelete?.targetUsername}</strong>?
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={deleteAction}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete Action
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={isProcessAllInfoOpen} onOpenChange={setIsProcessAllInfoOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Process All Queued Actions?</AlertDialogTitle>
            <AlertDialogDescription>
              This will attempt to process all currently queued actions. This may take some time depending on the number of actions.
              <br/><br/>
              <strong>Are you sure you want to proceed?</strong>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction 
              onClick={processAllActions}
              className="bg-green-600 hover:bg-green-700 text-white"
            >
              Start Processing
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
